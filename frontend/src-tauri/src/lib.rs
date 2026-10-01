mod commands;
mod process;
mod supervisor;

use tauri::{Emitter, Manager, WindowEvent};

use process::ServiceManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Auto-update: check/download/install come from the updater plugin
        // (called from the frontend's useUpdater hook); relaunch() comes from
        // the process plugin. Endpoint + public key live in tauri.conf.json
        // under plugins.updater — the frontend cannot override either, and
        // every download is signature-checked before anything is installed.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ServiceManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::start_services,
            commands::stop_services,
            commands::get_service_status,
            commands::exit_app,
            commands::diagnose_update_check,
        ])
        .setup(|app| {
            // Startup: the window is already visible; services start on a
            // worker thread and the UI
            // is told about every state change via "services-status", so the
            // dashboard can appear the moment the backend is ready.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let manager = app_handle.state::<ServiceManager>();
                let emit = |s: process::ServiceStatus| {
                    let _ = app_handle.emit("services-status", s);
                };
                manager.start(&app_handle, &emit);
            });

            // Native X close button (spec section 16 / RULE 8): stop both
            // services before the window actually closes, so Task Manager
            // never shows a leftover SystemMonitor.Api.exe
            // after the app is gone. `prevent_close` + manual `app.exit()`
            // turns the otherwise-immediate close into "clean up, then
            // close" without blocking the UI thread on the whole shutdown.
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let app_handle = app_handle.clone();
                        std::thread::spawn(move || {
                            let manager = app_handle.state::<ServiceManager>();
                            process::shutdown(&manager);
                            app_handle.exit(0);
                        });
                    }
                    // Deliberately no handling of Resized/Moved/Focused —
                    // minimize and maximize are plain native window-manager
                    // behavior here (decorations: true in tauri.conf.json)
                    // and never reach this handler at all, so services are
                    // never touched by them (spec sections 9/55/56: minimize
                    // must not stop services).
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SystemInfo");
}
