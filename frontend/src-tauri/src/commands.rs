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
