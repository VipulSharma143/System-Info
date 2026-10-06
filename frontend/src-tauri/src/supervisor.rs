//! Tauri-independent service supervision: spawn, readiness, exit detection,
//! stale-process cleanup, cancellation. Kept free of any `tauri` import so it
//! can be unit-tested with plain `cargo test` against fake services.
//!
//! Design rules (each one fixes a concrete failure found in the old code):
//!  * No lock is ever held while waiting for readiness. The old code held the
//!    backend mutex for up to 30 s while `get_service_status` (called by the
//!    UI on mount, on the main thread) tried to take the same mutex, which
//!    froze the window until the backend came up.
//!  * `status()` never does network I/O and never blocks.
//!  * A child that exits during startup is reported immediately instead of
//!    after a 30 s timeout.
//!  * A port that is already taken is detected before spawn: a stale process
//!    answering /health must not be mistaken for the service we just started.
//!  * Services are started concurrently, so adding one never lengthens startup.

use std::fs::OpenOptions;
use std::io::{self, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ServiceHealth {
    Stopped,
    Starting,
    Running,
    /// Failed to start, exited, timed out, or its port was taken. Non-fatal
    /// for the app; the UI shows a partial/degraded state.
    Unavailable,
}

/// Health of every supervised service, in the order they were registered.
pub type ServiceStatus = Vec<ServiceHealth>;

const S_STOPPED: u8 = 0;
const S_STARTING: u8 = 1;
const S_RUNNING: u8 = 2;
const S_UNAVAILABLE: u8 = 3;

fn to_health(v: u8) -> ServiceHealth {
    match v {
        S_STARTING => ServiceHealth::Starting,
        S_RUNNING => ServiceHealth::Running,
        S_UNAVAILABLE => ServiceHealth::Unavailable,
        _ => ServiceHealth::Stopped,
    }
}

/// A spawned child plus (Windows) the Job Object that kills it and all of its
/// descendants when dropped — including when this app crashes.
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
            let job = win32job::Job::create()
                .map_err(|e| io::Error::other(format!("failed to create job object: {e}")))?;
            let mut info = job
                .query_extended_limit_info()
                .map_err(|e| io::Error::other(format!("failed to query job limits: {e}")))?;
            info.limit_kill_on_job_close();
            job.set_extended_limit_info(&info)
                .map_err(|e| io::Error::other(format!("failed to set job limits: {e}")))?;
            job.assign_process(child.as_raw_handle() as isize)
                .map_err(|e| io::Error::other(format!("failed to assign job: {e}")))?;
            return Ok(Self { child, _job: job });
        }
        #[cfg(not(windows))]
        Ok(Self { child })
    }

    fn kill(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct Service {
    pub name: &'static str,
    pub port: u16,
    /// Executable file name, used to verify a stale pid really is ours.
    pub exe_name: &'static str,
    slot: Mutex<Option<Guarded>>,
    state: AtomicU8,
}

impl Service {
    pub fn new(name: &'static str, port: u16, exe_name: &'static str) -> Self {
        Self {
            name,
            port,
            exe_name,
            slot: Mutex::new(None),
            state: AtomicU8::new(S_STOPPED),
        }
    }

    /// Non-blocking. If the slot is momentarily locked by the readiness loop
    /// we trust the atomic state rather than waiting.
    pub fn health(&self) -> ServiceHealth {
        let s = self.state.load(Ordering::Acquire);
        if s == S_RUNNING {
            if let Ok(mut g) = self.slot.try_lock() {
                let dead = match g.as_mut() {
                    Some(c) => !matches!(c.child.try_wait(), Ok(None)),
                    None => true,
                };
                if dead {
                    *g = None;
                    self.state.store(S_UNAVAILABLE, Ordering::Release);
                    return ServiceHealth::Unavailable;
                }
            }
        }
        to_health(self.state.load(Ordering::Acquire))
    }

    fn set(&self, s: u8) {
        self.state.store(s, Ordering::Release);
    }
}

pub struct Supervisor {
    pub services: Vec<Service>,
    cancel: AtomicBool,
    starting: AtomicBool,
    pub t0: Instant,
}

/// What the caller (process.rs) prepares per service: a ready-to-spawn
/// command, or the reason it could not be built (missing executable, ...).
pub struct Launch {
    pub command: io::Result<Command>,
    pub timeout: Duration,
}

impl Supervisor {
    pub fn new(services: Vec<Service>) -> Self {
        Self { services, cancel: AtomicBool::new(false), starting: AtomicBool::new(false), t0: Instant::now() }
    }

    pub fn status(&self) -> ServiceStatus {
        self.services.iter().map(Service::health).collect()
    }

    /// Starts all services concurrently and returns when each has either
    /// become ready or definitively failed. `on_change` fires after every
    /// state transition so the UI can update as soon as the backend is ready
    /// instead of waiting for the slower analytics binary.
    /// A second call while a start is in progress returns immediately.
    pub fn start(
        &self,
        log_dir: &Path,
        launches: Vec<Launch>,
        on_change: &(dyn Fn(ServiceStatus) + Sync),
    ) -> ServiceStatus {
        if self.starting.swap(true, Ordering::AcqRel) {
            return self.status();
        }
        self.cancel.store(false, Ordering::Release);
        let _ = std::fs::create_dir_all(log_dir);
        rotate_log(&log_dir.join("startup.log"), 512 * 1024);
        for svc in &self.services {
            rotate_log(&log_dir.join(format!("{}.log", svc.name)), 5 * 1024 * 1024);
        }
        log_line(log_dir, "startup.log", &format!("---- start requested (+{} ms since app launch)", self.t0.elapsed().as_millis()));

        std::thread::scope(|s| {
            for (svc, launch) in self.services.iter().zip(launches) {
                s.spawn(move || self.start_one(svc, launch, log_dir, on_change));
            }
        });

        let st = self.status();
        log_line(log_dir, "startup.log", &format!("start finished (+{} ms): {:?}", self.t0.elapsed().as_millis(), st));
        self.starting.store(false, Ordering::Release);
        on_change(st.clone());
        st
    }

    fn start_one(&self, svc: &Service, launch: Launch, log_dir: &Path, on_change: &(dyn Fn(ServiceStatus) + Sync)) {
        let tag = format!("{}.log", svc.name);
        let ulog = |m: &str| {
            log_line(log_dir, "startup.log", &format!("[{}] {m}", svc.name));
            log_line(log_dir, &tag, &format!("[supervisor] {m}"));
        };

        // Already running and alive: leave it alone (double Start click).
        if svc.health() == ServiceHealth::Running || svc.health() == ServiceHealth::Starting {
            return;
        }

        let command = match launch.command {
            Ok(c) => c,
            Err(e) => {
                ulog(&format!("cannot start: {e}"));
                svc.set(S_UNAVAILABLE);
                on_change(self.status());
                return;
            }
        };

        // Stale process from an earlier run that was killed uncleanly?
        let pidfile = pidfile_path(log_dir, svc.name);
        if !port_free(svc.port) {
            if kill_stale(&pidfile, svc.exe_name) {
                ulog("terminated a stale process left by a previous run");
                for _ in 0..20 {
                    if port_free(svc.port) { break; }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
            if !port_free(svc.port) {
                ulog(&format!("port {} is in use by another program; not starting (would be indistinguishable from a healthy service)", svc.port));
                svc.set(S_UNAVAILABLE);
                on_change(self.status());
                return;
            }
        }

        let spawned_at = Instant::now();
        let guarded = match Guarded::spawn(command) {
            Ok(g) => g,
            Err(e) => {
                ulog(&format!("spawn failed: {e}"));
                svc.set(S_UNAVAILABLE);
                on_change(self.status());
                return;
            }
        };
        let pid = guarded.child.id();
        let _ = std::fs::write(&pidfile, pid.to_string());
        *svc.slot.lock().unwrap() = Some(guarded);
        svc.set(S_STARTING);
        ulog(&format!("spawned pid {pid} (+{} ms since app launch)", self.t0.elapsed().as_millis()));
        on_change(self.status());

        let deadline = spawned_at + launch.timeout;
        loop {
            if self.cancel.load(Ordering::Acquire) {
                ulog("start cancelled");
                return; // stop() owns cleanup and the state
            }
            // 1. Did the process die? (short lock, no waiting inside it)
            {
                let mut slot = svc.slot.lock().unwrap();
                match slot.as_mut().map(|g| g.child.try_wait()) {
                    Some(Ok(Some(status))) => {
                        ulog(&format!("process exited during startup: {status}"));
                        *slot = None;
                        let _ = std::fs::remove_file(&pidfile);
                        svc.set(S_UNAVAILABLE);
                        drop(slot);
                        on_change(self.status());
                        return;
                    }
                    None => return, // taken by stop()
                    _ => {}
                }
            }
            // 2. Ready?
            if probe(svc.port) {
                svc.set(S_RUNNING);
                ulog(&format!("ready in {} ms (+{} ms since app launch)", spawned_at.elapsed().as_millis(), self.t0.elapsed().as_millis()));
                on_change(self.status());
                return;
            }
            if Instant::now() >= deadline {
                ulog(&format!("not ready after {} s; stopping it", launch.timeout.as_secs()));
                if let Some(g) = svc.slot.lock().unwrap().take() { g.kill(); }
                let _ = std::fs::remove_file(&pidfile);
                svc.set(S_UNAVAILABLE);
                on_change(self.status());
                return;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    /// Stops all services and aborts any start in progress.
    pub fn stop(&self, log_dir: &Path) -> ServiceStatus {
        self.cancel.store(true, Ordering::Release);
        for svc in &self.services {
            if let Some(g) = svc.slot.lock().unwrap().take() {
                g.kill();
            }
            let _ = std::fs::remove_file(pidfile_path(log_dir, svc.name));
            svc.set(S_STOPPED);
        }
        self.status()
    }

    /// Stops every service, then WAITS until the operating system has really let go of what an installer is
    /// about to replace: each service's port is free, its process is gone, and none of `watch` (the backend
    /// executable and its native library) is still held open or mapped.
    ///
    /// `stop()` returning only proves the child was signalled and reaped. It does not prove the files are
    /// writable: on Windows a just-exited executable stays locked for a moment while the kernel tears down
    /// the image section and antivirus/indexers finish scanning it, and on Linux the text of a killed binary
    /// is busy until the last mapping goes. Starting an installer inside that window is the intermittent
    /// "first attempt fails, immediate Retry works" failure, because by the time Retry runs the files are free.
    /// Waiting on the actual condition (not a fixed sleep) makes the first attempt as safe as the second.
    pub fn stop_and_wait_released(
        &self,
        log_dir: &Path,
        watch: &[PathBuf],
        timeout: Duration,
    ) -> (ServiceStatus, ReleaseReport) {
        let started = Instant::now();
        let status = self.stop(log_dir);
        let report = wait_released(self.services.iter().map(|s| s.port).collect::<Vec<_>>().as_slice(), watch, timeout);
        log_line(
            log_dir,
            "update.log",
            &format!(
                "[prepare] released={} waited={} ms (stop took {} ms) {}",
                report.released,
                report.waited_ms,
                started.elapsed().as_millis().saturating_sub(report.waited_ms),
                report.detail
            ),
        );
        (status, report)
    }
}

/// Outcome of waiting for the OS to release ports and files after a stop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReleaseReport {
    pub released: bool,
    pub waited_ms: u128,
    /// Empty when released; otherwise names what was still held when the wait gave up.
    pub detail: String,
}

/// Polls until every port is free and every watched file can be opened for writing, or `timeout` passes.
/// The poll interval backs off from 25 ms to 250 ms: the normal case (already free) costs one pass, a slow
/// release does not busy-loop.
pub fn wait_released(ports: &[u16], watch: &[PathBuf], timeout: Duration) -> ReleaseReport {
    let started = Instant::now();
    let mut delay = Duration::from_millis(25);
    loop {
        let blockers = held_resources(ports, watch);
        if blockers.is_empty() {
            return ReleaseReport { released: true, waited_ms: started.elapsed().as_millis(), detail: String::new() };
        }
        if started.elapsed() >= timeout {
            return ReleaseReport { released: false, waited_ms: started.elapsed().as_millis(), detail: blockers.join("; ") };
        }
        std::thread::sleep(delay);
        delay = (delay * 2).min(Duration::from_millis(250));
    }
}

fn held_resources(ports: &[u16], watch: &[PathBuf]) -> Vec<String> {
    let mut held = Vec::new();
    for port in ports {
        if !port_free(*port) {
            held.push(format!("port {port} still in use"));
        }
    }
    for path in watch {
        if is_locked(path) {
            held.push(format!("{} is still locked", path.display()));
        }
    }
    held
}

/// True when `path` exists but cannot currently be opened for writing (Windows sharing violation, Linux
/// ETXTBSY on a running executable). A missing file is NOT locked: there is nothing to block replacement.
/// Opening for write without `truncate` or `create` never modifies the file.
pub fn is_locked(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    match OpenOptions::new().write(true).open(path) {
        Ok(_) => false,
        Err(e) => {
            // Windows: ERROR_SHARING_VIOLATION (32) / ERROR_LOCK_VIOLATION (33); Linux: ETXTBSY (26).
            // Permission problems are not a lock: they would not clear by waiting, and the installer
            // is the one that runs elevated or reports them.
            matches!(e.raw_os_error(), Some(32) | Some(33)) || (cfg!(unix) && e.raw_os_error() == Some(26))
        }
    }
}

/// Minimal HTTP/1.0 GET /health against loopback using only std — the whole
/// job is "does it answer with a non-5xx status", so an HTTP client crate
/// would be pure dependency weight. Bounded by short connect/read timeouts so
/// a wedged service can never stall the readiness loop.
fn probe(port: u16) -> bool {
    use std::io::Read;
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    if stream.write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut buf = [0u8; 32];
    let Ok(n) = stream.read(&mut buf) else { return false };
    // "HTTP/1.1 200 OK" -> status code at bytes 9..12
    std::str::from_utf8(&buf[..n])
        .ok()
        .filter(|t| t.starts_with("HTTP/"))
        .and_then(|t| t.get(9..12))
        .and_then(|c| c.parse::<u16>().ok())
        .is_some_and(|code| code < 500)
}

/// True if nothing is listening on 127.0.0.1:port. Connecting (rather than
/// binding) avoids SO_REUSEADDR ambiguity; a refused connection means free.
pub fn port_free(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
        return false;
    }
    TcpListener::bind(addr).is_ok()
}

fn pidfile_path(log_dir: &Path, name: &str) -> PathBuf {
    log_dir.join(format!("{name}.pid"))
}

/// Kills the process recorded in `pidfile` — but only if it is still alive AND
/// its executable is really `exe_name` (guards against pid reuse). Windows
/// needs none of this: the Job Object already kills children when the app dies.
#[cfg(unix)]
fn kill_stale(pidfile: &Path, exe_name: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(pidfile) else { return false };
    let Ok(pid) = text.trim().parse::<u32>() else { return false };
    let Ok(exe) = std::fs::read_link(format!("/proc/{pid}/exe")) else { return false };
    if exe.file_name().and_then(|n| n.to_str()) != Some(exe_name) {
        return false;
    }
    Command::new("kill").args(["-KILL", &pid.to_string()]).status().map(|s| s.success()).unwrap_or(false)
}

#[cfg(not(unix))]
fn kill_stale(_pidfile: &Path, _exe_name: &str) -> bool {
    false
}

pub fn log_line(dir: &Path, name: &str, line: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(dir.join(name)) {
        let _ = writeln!(f, "{line}");
    }
}

/// Keeps logs bounded: if the file exceeds `max` bytes, keep one `.old` copy.
pub fn rotate_log(path: &Path, max: u64) {
    if std::fs::metadata(path).map(|m| m.len() > max).unwrap_or(false) {
        let _ = std::fs::rename(path, path.with_extension("log.old"));
    }
}
