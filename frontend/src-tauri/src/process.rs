//! Owns the lifecycle of the two child services SystemInfo depends on:
//!
//!   - SystemMonitor.Api(.exe)  — the ASP.NET backend, port 5132
//!   - analytics(.exe)          — the Python/FastAPI analytics service, port 8001
//!
//! This is the direct Rust successor to `launcher/Program.cs`: same startup
//! sequence (start backend, wait for it, start analytics, wait for it,
//! non-fatal if analytics doesn't come up), same idea of "own every process
//! you start and kill it on the way out" — just driven by Tauri's window
//! lifecycle instead of a console app that opens a browser tab and then
//! blocks in a sleep loop.
//!
//! Windows orphan-process hardening (spec section 21): PyInstaller's
//! `--onefile` build extracts itself to a temp directory at startup and
//! launches the *real* interpreter as a child of the process we spawned —
//! so `Child::kill()` on the PID we hold only kills the onefile bootstrap,
//! not necessarily the process actually serving :8001. To guarantee nothing
//! survives us, every child we spawn is assigned to its own Windows Job
//! Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: dropping the
//! Job (explicit Stop, Exit, X-close, or an unexpected crash of this app —
//! the OS closes our handles for us either way) kills every process in that
//! job, direct child or grandchild. `win32job` is the de facto standard safe
//! wrapper for this Win32 API (used across the Rust ecosystem for exactly
//! this "don't leak subprocesses" problem). On Linux this collapses to a
//! plain `Child::kill()` — the dev-only platform for this project, and
//! `analytics_service.py`/`SystemMonitor.Api` aren't onefile-bootstrapped
//! there.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

// Needed for `.creation_flags(CREATE_NO_WINDOW)` below — Windows-only,
// since `Command` has no such method on other platforms.
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const BACKEND_PORT: u16 = 5132;
const ANALYTICS_PORT: u16 = 8001;
const BACKEND_URL: &str = "http://127.0.0.1:5132";
const ANALYTICS_URL: &str = "http://127.0.0.1:8001";
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(400);

// Windows API constant (winbase.h): tells CreateProcess not to allocate a
// console for a console-subsystem child. Without this, spawning
// SystemMonitor.Api.exe / analytics.exe — both console-subsystem builds —
// from this GUI-subsystem app pops up a visible (empty, since stdout/stderr
// are already redirected to log files below) console window per process.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceHealth {
    Stopped,
    Starting,
    Running,
    /// Process/health check didn't come up in time. Non-fatal — mirrors the
    /// graceful-degradation the backend already applies to a dead analytics
    /// service (AnalyticsEndpoints.cs returns 503 rather than erroring).
    /// Not yet constructed on the Rust side (hence the dead-code warning
    /// without this attribute) but IS part of the real cross-language
    /// contract: frontend/src/hooks/useServiceControl.ts's ServiceHealth
    /// type already includes 'unavailable', and ServiceControls.tsx already
    /// branches on analytics === 'unavailable' to show "Partial — analytics
    /// unavailable". Reserved for when a service fails its readiness check
    /// but the app should stay open in a degraded state rather than exiting.
    #[allow(dead_code)]
    Unavailable,
}

#[derive(Clone, Serialize)]
pub struct ServiceStatus {
    pub backend: ServiceHealth,
    pub analytics: ServiceHealth,
}

/// A spawned child plus (on Windows) the Job Object guarding it. Dropping
/// this drops the Job, which — because of KILL_ON_JOB_CLOSE — kills the
/// child and anything it spawned, even if we never see those descendants.
struct Guarded {
    child: Child,
    #[cfg(windows)]
    _job: win32job::Job,
}

impl Guarded {
    fn spawn(mut command: Command) -> io::Result<Self> {
        let child = command.spawn()?;

        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            let job = win32job::Job::create().map_err(|e| {
                io::Error::other(format!("failed to create Windows job object: {e}"))
            })?;
            let mut info = job
                .query_extended_limit_info()
                .map_err(|e| io::Error::other(format!("failed to query job limits: {e}")))?;
            info.limit_kill_on_job_close();
            job.set_extended_limit_info(&info)
                .map_err(|e| io::Error::other(format!("failed to set job limits: {e}")))?;
            job.assign_process(child.as_raw_handle() as isize)
                .map_err(|e| io::Error::other(format!("failed to assign process to job: {e}")))?;
            return Ok(Self { child, _job: job });
        }

        #[cfg(not(windows))]
        {
            Ok(Self { child })
        }
    }

    /// Kill the direct child and (on Windows) let the Job drop clean up any
    /// descendants. Best-effort: a process that's already gone is not an
    /// error here.
    fn kill(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        // `self` drops here, dropping `_job` on Windows too.
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

pub struct ServiceManager {
    backend: Mutex<Option<Guarded>>,
    analytics: Mutex<Option<Guarded>>,
}

impl ServiceManager {
    pub fn new() -> Self {
        Self {
            backend: Mutex::new(None),
            analytics: Mutex::new(None),
        }
    }

    /// Full startup sequence: start backend, wait for readiness, start
    /// analytics, wait for readiness (non-fatal). Safe to call again after
    /// `stop()` — that's exactly what the Start/Resume button does. Also
    /// safe to call when a service is already running: it's left alone
    /// rather than restarted, so clicking Start twice doesn't spawn
    /// duplicate processes.
    pub fn start(&self, app: &AppHandle) -> ServiceStatus {
        let log_dir = data_root().join("logs");
        let _ = std::fs::create_dir_all(&log_dir);

        {
            let mut backend = self.backend.lock().unwrap();
            let needs_start = match backend.as_mut() {
                Some(g) => !g.is_alive(),
                None => true,
            };
            if needs_start {
                match spawn_backend(app, &log_dir) {
                    Ok(child) => {
                        *backend = Some(child);
                        wait_for_http(&format!("{BACKEND_URL}/health"), READY_TIMEOUT);
                    }
                    Err(e) => {
                        log_line(&log_dir, "backend.log", &format!("[tauri] failed to start backend: {e}"));
                    }
                }
            }
        }

        {
            let mut analytics = self.analytics.lock().unwrap();
            let needs_start = match analytics.as_mut() {
                Some(g) => !g.is_alive(),
                None => true,
            };
            if needs_start {
                match spawn_analytics(app, &log_dir) {
                    Ok(child) => {
                        *analytics = Some(child);
                        if !wait_for_http(&format!("{ANALYTICS_URL}/health"), READY_TIMEOUT) {
                            log_line(
                                &log_dir,
                                "analytics.log",
                                "[tauri] analytics did not become ready in time; continuing without it.",
                            );
                        }
                    }
                    Err(e) => {
                        log_line(&log_dir, "analytics.log", &format!("[tauri] failed to start analytics: {e}"));
                    }
                }
            }
        }

        self.status()
    }

    /// Stops both services but does NOT touch the app/window — this is the
    /// UI's "Stop" button, distinct from `exit()` below. See the
    /// STOP-vs-EXIT table in the migration spec.
    pub fn stop(&self) -> ServiceStatus {
        if let Some(g) = self.backend.lock().unwrap().take() {
            g.kill();
        }
        if let Some(g) = self.analytics.lock().unwrap().take() {
            g.kill();
        }
        self.status()
    }

    /// Live status, based on an actual health probe rather than "do we hold
    /// a Child handle" — a handle can outlive a crashed process, and we
    /// never want the UI to keep reporting "Running" for something that
    /// silently died (spec section 50).
    pub fn status(&self) -> ServiceStatus {
        let backend_alive = self
            .backend
            .lock()
            .unwrap()
            .as_mut()
            .is_some_and(Guarded::is_alive);
        let analytics_alive = self
            .analytics
            .lock()
            .unwrap()
            .as_mut()
            .is_some_and(Guarded::is_alive);

        let backend = if backend_alive && probe_http(&format!("{BACKEND_URL}/health")) {
            ServiceHealth::Running
        } else if backend_alive {
            ServiceHealth::Starting
        } else {
            ServiceHealth::Stopped
        };

        let analytics = if analytics_alive && probe_http(&format!("{ANALYTICS_URL}/health")) {
            ServiceHealth::Running
        } else if analytics_alive {
            ServiceHealth::Starting
        } else {
            ServiceHealth::Stopped
        };

        ServiceStatus { backend, analytics }
    }
}

/// Called from the window close handler and the Exit command. Identical to
/// `stop()` — kept as a separate name so call sites read as intent
/// ("shutting down for good") rather than the user-facing Stop action, even
/// though the mechanics are the same.
pub fn shutdown(manager: &ServiceManager) {
    manager.stop();
}

fn spawn_backend(app: &AppHandle, log_dir: &Path) -> io::Result<Guarded> {
    let exe = resolve_backend_exe(app)?;
    let data_dir = data_root().join("data");
    std::fs::create_dir_all(&data_dir)?;

    let mut cmd = Command::new(&exe);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    cmd.env("ASPNETCORE_URLS", format!("http://127.0.0.1:{BACKEND_PORT}"))
        .env("ASPNETCORE_ENVIRONMENT", "Production")
        .env("SYSTEM_INFO_DATA_DIR", &data_dir)
        .stdout(log_file(log_dir, "backend.log")?)
        .stderr(log_file(log_dir, "backend.log")?);

    Guarded::spawn(cmd)
}

fn spawn_analytics(app: &AppHandle, log_dir: &Path) -> io::Result<Guarded> {
    let exe = resolve_analytics_exe(app)?;
    let data_dir = data_root().join("data");
    std::fs::create_dir_all(&data_dir)?;

    let mut cmd = Command::new(&exe);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    cmd.args(["--port", &ANALYTICS_PORT.to_string(), "--host", "127.0.0.1"])
        .env("SYSTEM_INFO_DATA_DIR", &data_dir)
        .stdout(log_file(log_dir, "analytics.log")?)
        .stderr(log_file(log_dir, "analytics.log")?);

    Guarded::spawn(cmd)
}

/// `%LOCALAPPDATA%\SystemInfo` on Windows, `~/.local/share/SystemInfo` on
/// Linux — deliberately the exact same path `AppDataPath.cs` and
/// `analytics_service.py` already fall back to on their own, so the
/// `SYSTEM_INFO_DATA_DIR` we inject here isn't introducing a new location,
/// just making the three processes agree on it explicitly instead of each
/// re-deriving it independently (same reasoning `launcher/Program.cs` used).
fn data_root() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local).join("SystemInfo");
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = dirs_home() {
            return home.join(".local").join("share").join("SystemInfo");
        }
    }
    // Last-resort fallback so a missing env var can't panic the app.
    std::env::temp_dir().join("SystemInfo")
}

#[cfg(not(windows))]
fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn log_file(dir: &Path, name: &str) -> io::Result<Stdio> {
    let path = dir.join(name);
    let file = OpenOptions::new().create(true).append(true).open(path)?;
    Ok(Stdio::from(file))
}

fn log_line(dir: &Path, name: &str, line: &str) {
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(name))
    {
        use std::io::Write;
        let _ = writeln!(f, "{line}");
    }
}

/// Resolves the packaged backend executable. In a bundled/installed app
/// this is the `resources/backend/**` payload declared in tauri.conf.json's
/// `bundle.resources` (see the CI packaging step). In `tauri dev`, no
/// resources are staged, so we fall back to the local `dotnet publish`/
/// `dotnet build` output next to the source tree — see README for the dev
/// workflow this expects.
fn resolve_backend_exe(app: &AppHandle) -> io::Result<PathBuf> {
    let exe_name = if cfg!(windows) {
        "SystemMonitor.Api.exe"
    } else {
        "SystemMonitor.Api"
    };

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("backend").join(exe_name);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    find_in_bin_output(exe_name, &dev_repo_root().join("backend").join("SystemMonitor.Api").join("bin"))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!(
                    "{exe_name} not found in app resources or in backend/SystemMonitor.Api/bin \
                     (dev mode). Run `dotnet build backend/SystemMonitor.Api` first, or `tauri build` \
                     to package resources."
                ),
            )
        })
}

fn resolve_analytics_exe(app: &AppHandle) -> io::Result<PathBuf> {
    let exe_name = if cfg!(windows) { "analytics.exe" } else { "analytics" };

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("analytics").join(exe_name);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let dev_candidate = dev_repo_root().join("analytics").join("dist").join(exe_name);
    if dev_candidate.exists() {
        return Ok(dev_candidate);
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!(
            "{exe_name} not found in app resources or in analytics/dist (dev mode). \
             Run the PyInstaller build first (see analytics/requirements-build.txt), \
             or `tauri build` to package resources."
        ),
    ))
}

/// `frontend/src-tauri` -> repo root, for locating dev-mode build output.
/// Resources are the production path; this is only ever consulted when
/// `resource_dir()` has nothing, i.e. `tauri dev`.
fn dev_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Debug/Release and target-framework folder names vary across machines and
/// .NET versions, so rather than hardcoding
/// `bin/Debug/net10.0/SystemMonitor.Api.exe`, walk `bin/` for the requested
/// file and take whichever match was built most recently.
fn find_in_bin_output(file_name: &str, bin_dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    let mut stack = vec![bin_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|n| n.to_str()) == Some(file_name) {
                let modified = entry.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                if best.as_ref().is_none_or(|(t, _)| modified > *t) {
                    best = Some((modified, path));
                }
            }
        }
    }
    best.map(|(_, path)| path)
}

/// Blocks until `url` answers with a non-5xx status or `timeout` elapses.
/// Direct Rust translation of `launcher/Program.cs`'s `WaitForHttp` — same
/// "listening isn't the same as ready" reasoning (spec section 14).
fn wait_for_http(url: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if probe_http(url) {
            return true;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    false
}

fn probe_http(url: &str) -> bool {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(2))
        .build()
        .get(url)
        .call()
        .map(|resp| resp.status() < 500)
        .unwrap_or(false)
}