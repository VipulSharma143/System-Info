//! Tauri-facing layer over `supervisor.rs`: resolves the packaged backend executable
//! from the app's resource directory, builds the child `Command`s (platform
//! flags, environment, log redirection) and exposes the small API that
//! `commands.rs` / `lib.rs` use. All lifecycle logic lives in supervisor.rs.
//!
//! Production path resolution order for each executable:
//!   1. `<resource_dir>/backend/<exe>`             (installed app)
//!   2. dev build output under the repo (`tauri dev` only; never reached in a
//!      packaged app because step 1 succeeds)
//! Nothing here depends on PATH, the current directory, or a global runtime.
//!
//! Windows: the child is created with CREATE_NO_WINDOW (no console flash) and
//! placed in a kill-on-close Job Object (see supervisor.rs), so a crash of
//! this app cannot leave the backend process behind.
//! Linux: no terminal environment is assumed; a pid file lets the next launch
//! reap a process left over by an uncleanly terminated run.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::supervisor::{self, Launch, ReleaseReport, Service, Supervisor};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const BACKEND_PORT: u16 = 5132;
/// Upper bound only. Readiness is detected by polling every 100 ms and a
/// crashed child is reported immediately, so this is never the normal path.
const BACKEND_TIMEOUT: Duration = Duration::from_secs(45);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceHealth {
    Stopped,
    Starting,
    Running,
    Unavailable,
}

#[derive(Clone, Serialize)]
pub struct ServiceStatus {
    pub backend: ServiceHealth,
}

impl From<supervisor::ServiceHealth> for ServiceHealth {
    fn from(h: supervisor::ServiceHealth) -> Self {
        match h {
            supervisor::ServiceHealth::Stopped => Self::Stopped,
            supervisor::ServiceHealth::Starting => Self::Starting,
            supervisor::ServiceHealth::Running => Self::Running,
            supervisor::ServiceHealth::Unavailable => Self::Unavailable,
        }
    }
}

impl From<supervisor::ServiceStatus> for ServiceStatus {
    fn from(s: supervisor::ServiceStatus) -> Self {
        Self { backend: s.first().copied().map_or(ServiceHealth::Stopped, Into::into) }
    }
}

/// Result of `prepare_for_update`, sent to the frontend. `released == false` means the installer must NOT run.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResult {
    pub released: bool,
    pub waited_ms: u64,
    pub detail: String,
}

impl From<ReleaseReport> for PrepareResult {
    fn from(r: ReleaseReport) -> Self {
        Self { released: r.released, waited_ms: r.waited_ms.min(u64::MAX as u128) as u64, detail: r.detail }
    }
}

/// Appends one line from the frontend's updater to `update.log` (bounded, rotated). The cause chain of a failed
/// update is written at the moment it fails; re-running the check afterwards would only ever see the retry.
pub fn log_update_event(line: &str) {
    let dir = data_root().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    supervisor::rotate_log(&dir.join("update.log"), 512 * 1024);
    let clipped: String = line.chars().take(4000).collect();
    supervisor::log_line(&dir, "update.log", &clipped);
}

/// Executables and libraries shipped next to the backend: exactly what an installer has to overwrite.
fn backend_files(app: &AppHandle) -> Vec<PathBuf> {
    let Ok(resource_dir) = app.path().resource_dir() else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(resource_dir.join("backend")) else { return Vec::new() };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && matches!(p.extension().and_then(|e| e.to_str()), Some("exe" | "dll" | "so"))
        })
        .take(256)
        .collect()
}

pub struct ServiceManager {
    sup: Supervisor,
}

impl ServiceManager {
    pub fn new() -> Self {
        Self { sup: Supervisor::new(vec![Service::new("backend", BACKEND_PORT, leak(exe_name("SystemMonitor.Api")))]) }
    }

    /// Blocking: returns once the backend is ready or definitively failed.
    /// Must be called from a worker thread (lib.rs setup thread, or the
    /// `spawn_blocking` in commands.rs) — never from the UI thread.
    /// `on_change` fires on every state change so the UI can update at once.
    pub fn start(&self, app: &AppHandle, on_change: &(dyn Fn(ServiceStatus) + Sync)) -> ServiceStatus {
        let log_dir = data_root().join("logs");
        let _ = std::fs::create_dir_all(&log_dir);
        let backend = Launch { command: backend_command(app, &log_dir), timeout: BACKEND_TIMEOUT };
        self.sup.start(&log_dir, vec![backend], &|s| on_change(s.into())).into()
    }

    pub fn stop(&self) -> ServiceStatus {
        self.sup.stop(&data_root().join("logs")).into()
    }

    /// Stops the backend and waits until its port, process and every file in the install's backend folder are
    /// released, so an installer never races the operating system for them. Blocking: worker thread only.
    pub fn prepare_for_update(&self, app: &AppHandle, timeout: Duration) -> PrepareResult {
        let watch = backend_files(app);
        let (_, report) = self.sup.stop_and_wait_released(&data_root().join("logs"), &watch, timeout);
        report.into()
    }

    /// Non-blocking; never performs network I/O. Safe to call from any thread.
    pub fn status(&self) -> ServiceStatus {
        self.sup.status().into()
    }
}

/// Called from the window close handler and the Exit command.
pub fn shutdown(manager: &ServiceManager) {
    manager.stop();
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) { format!("{base}.exe") } else { base.to_string() }
}

// Executable names live for the whole process; leaking two tiny strings once
// avoids threading lifetimes through the manager for no benefit.
fn leak(s: String) -> &'static str {
    Box::leak(s.into_boxed_str())
}

fn backend_command(app: &AppHandle, log_dir: &Path) -> io::Result<Command> {
    let exe = resolve_exe(app, "backend", &exe_name("SystemMonitor.Api"), || {
        find_in_bin_output(&exe_name("SystemMonitor.Api"), &dev_repo_root().join("backend").join("SystemMonitor.Api").join("bin"))
    })?;
    let data_dir = data_root().join("data");
    std::fs::create_dir_all(&data_dir)?;

    let mut cmd = Command::new(&exe);
    prepare(&mut cmd, &exe);
    cmd.env("ASPNETCORE_URLS", format!("http://127.0.0.1:{BACKEND_PORT}"))
        .env("ASPNETCORE_ENVIRONMENT", "Production")
        .env("DOTNET_NOLOGO", "1")
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        // Loopback desktop app: workstation non-concurrent GC keeps memory and
        // startup cost low; there is no server-GC workload here.
        .env("DOTNET_gcServer", "0")
        .env("SYSTEM_INFO_DATA_DIR", &data_dir)
        .stdin(Stdio::null())
        .stdout(log_file(log_dir, "backend.log")?)
        .stderr(log_file(log_dir, "backend.log")?);
    Ok(cmd)
}

/// Platform flags + working directory for the child.
fn prepare(cmd: &mut Command, exe: &Path) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
}

/// `%LOCALAPPDATA%\SystemInfo` on Windows, `$XDG_DATA_HOME` or
/// `~/.local/share/SystemInfo` on Linux — the same location AppDataPath.cs
/// falls back to, so the app and the backend agree.
/// Runtime user data is never written under the install directory.
fn data_root() -> PathBuf {
    #[cfg(windows)]
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local).join("SystemInfo");
    }
    #[cfg(not(windows))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(xdg).join("SystemInfo");
        }
        if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(home).join(".local").join("share").join("SystemInfo");
        }
    }
    std::env::temp_dir().join("SystemInfo")
}

fn log_file(dir: &Path, name: &str) -> io::Result<Stdio> {
    let file = OpenOptions::new().create(true).append(true).open(dir.join(name))?;
    Ok(Stdio::from(file))
}

fn resolve_exe(
    app: &AppHandle,
    folder: &str,
    exe: &str,
    dev_fallback: impl FnOnce() -> Option<PathBuf>,
) -> io::Result<PathBuf> {
    let mut tried = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join(folder).join(exe);
        if candidate.exists() {
            return Ok(candidate);
        }
        tried.push(candidate);
    }
    if let Some(dev) = dev_fallback() {
        return Ok(dev);
    }
    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("{exe} not found. Looked in: {tried:?} and the dev build output. In a packaged app this means the installer is missing the {folder} resources."),
    ))
}

/// Dev-only: `frontend/src-tauri` -> repo root.
fn dev_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Dev-only: newest matching file under `bin/` regardless of Debug/Release or
/// target-framework folder names.
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
                if best.as_ref().map_or(true, |(t, _)| modified > *t) {
                    best = Some((modified, path));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}
