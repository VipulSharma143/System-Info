//! The only surface the frontend has onto process control. Deliberately
//! narrow (spec section 23: "the frontend must NOT receive unrestricted
//! shell access") — these four commands are the entire API; there is no
//! generic "run this command" entry point anywhere in the app.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::process::{PrepareResult, ServiceManager, ServiceStatus};

// Sync Tauri commands run on the main (UI) thread. Anything that can wait —
// starting services, stopping them (kill + wait) — is therefore async and
// pushed onto a blocking worker so the window can never freeze on it.
// `get_service_status` stays sync because it is now lock-free/non-blocking.

#[tauri::command]
pub async fn start_services(app: AppHandle) -> Result<ServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<ServiceManager>();
        let emit = |s: ServiceStatus| {
            let _ = app.emit("services-status", s);
        };
        manager.start(&app, &emit)
    })
    .await
    .map_err(|e| format!("start task failed: {e}"))
}

#[tauri::command]
pub async fn stop_services(app: AppHandle) -> Result<ServiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let status = app.state::<ServiceManager>().stop();
        let _ = app.emit("services-status", status.clone());
        status
    })
    .await
    .map_err(|e| format!("stop task failed: {e}"))
}

/// Stops the backend and waits for the OS to release its port, process and files, so the installer can replace
/// them on the FIRST attempt. Returns `released: false` (with what is still held) instead of letting the
/// installer run into a locked file; the frontend then retries this bounded wait, never the installer blindly.
#[tauri::command]
pub async fn prepare_for_update(app: AppHandle, timeout_ms: Option<u64>) -> Result<PrepareResult, String> {
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(10_000).clamp(500, 60_000));
    tauri::async_runtime::spawn_blocking(move || {
        let result = app.state::<ServiceManager>().prepare_for_update(&app, timeout);
        let _ = app.emit("services-status", app.state::<ServiceManager>().status());
        result
    })
    .await
    .map_err(|e| format!("prepare task failed: {e}"))
}

/// Writes one diagnostic line to the updater log. The only file the frontend can write, and only through here.
#[tauri::command]
pub fn log_update_event(line: String) {
    crate::process::log_update_event(&line);
}

#[tauri::command]
pub fn get_service_status(manager: State<'_, ServiceManager>) -> ServiceStatus {
    manager.status()
}

/// EXIT, as distinct from Stop — stops both services AND closes the app.
/// Shutdown runs on a worker thread; the app exits when it completes.
#[tauri::command]
pub fn exit_app(app: AppHandle) {
    std::thread::spawn(move || {
        crate::process::shutdown(&app.state::<ServiceManager>());
        app.exit(0);
    });
}

/// Runs the same update check the Updates tab runs, but returns the FULL
/// error chain as text. The JS-side error only carries the outermost message
/// (typically the unhelpful "error sending request for url (...)"); the real
/// reason — DNS, TLS certificate, timeout, proxy — is in the `source()` chain
/// that the plugin's error type keeps but the IPC boundary flattens away.
/// Only called after a failed manual check, to show the user what is wrong.
#[tauri::command]
pub async fn diagnose_update_check(app: AppHandle) -> String {
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return error_chain("could not create the updater", &e),
    };
    match updater.check().await {
        Ok(Some(update)) => format!("check succeeded: version {} is available", update.version),
        Ok(None) => "check succeeded: no update available".to_string(),
        Err(e) => error_chain("check failed", &e),
    }
}

fn error_chain(prefix: &str, err: &dyn std::error::Error) -> String {
    let mut out = format!("{prefix}: {err}");
    let mut source = err.source();
    while let Some(cause) = source {
        out.push_str(&format!("\n  caused by: {cause}"));
        source = cause.source();
    }
    out
}
