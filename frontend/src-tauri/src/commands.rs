//! The only surface the frontend has onto process control. Deliberately
//! narrow (spec section 23: "the frontend must NOT receive unrestricted
//! shell access") — these four commands are the entire API; there is no
//! generic "run this command" entry point anywhere in the app.

use tauri::{AppHandle, Emitter, State};

use crate::process::{ServiceManager, ServiceStatus};

#[tauri::command]
pub fn start_services(app: AppHandle, manager: State<'_, ServiceManager>) -> ServiceStatus {
    let status = manager.start(&app);
    let _ = app.emit("services-status", status.clone());
    status
}

#[tauri::command]
pub fn stop_services(app: AppHandle, manager: State<'_, ServiceManager>) -> ServiceStatus {
    let status = manager.stop();
    let _ = app.emit("services-status", status.clone());
    status
}

#[tauri::command]
pub fn get_service_status(manager: State<'_, ServiceManager>) -> ServiceStatus {
    manager.status()
}

/// EXIT, as distinct from Stop — stops both services AND closes the app.
/// See the STOP-vs-EXIT-vs-X-close table in the migration spec; the X-close
/// path reuses this same manager through the window's CloseRequested
/// handler in lib.rs rather than duplicating the shutdown sequence.
#[tauri::command]
pub fn exit_app(app: AppHandle, manager: State<'_, ServiceManager>) {
    crate::process::shutdown(&manager);
    app.exit(0);
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
