mod autostart;
mod commands;
mod instance;
mod process;
mod settings;
mod shell;
mod supervisor;

use tauri::{Emitter, Manager, WindowEvent};

use process::ServiceManager;
use shell::Shell;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // One System Info per user. A second launch asks the running one to show its window and exits; a launch that
    // is really a restart waits for the old process to finish (see instance.rs).
    let guard = match instance::acquire(instance::TAKEOVER_WAIT) {
        instance::Role::Secondary => return,
        instance::Role::Primary(guard) => Some(guard),
        instance::Role::Unguarded => None,
    };
    let closing = guard.as_ref().map(instance::Guard::closing_flag).unwrap_or_default();

    // Fresh install vs. update is decided from what is on disk before anything below creates folders (settings.rs).
    let settings = settings::load_or_initialise(&process::data_root());
    let started_by_os = std::env::args().any(|a| a == autostart::AUTOSTART_ARG);

    tauri::Builder::default()
        // Auto-update: check/download/install come from the updater plugin
        // (called from the frontend's useUpdater hook); relaunch() comes from
        // the process plugin. Endpoint + public key live in tauri.conf.json
        // under plugins.updater — the frontend cannot override either, and
        // every download is signature-checked before anything is installed.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ServiceManager::new())
        .manage(Shell::new(process::data_root(), settings, closing))
        .invoke_handler(tauri::generate_handler![
            commands::start_services,
            commands::stop_services,
            commands::get_service_status,
            commands::exit_app,
            commands::prepare_for_update,
            commands::log_update_event,
            commands::diagnose_update_check,
            commands::get_startup_behavior,
            commands::set_startup_behavior,
            commands::begin_restart,
        ])
        .setup(move |app| {
            // The tray exists exactly while a background mode is chosen; if the desktop has no notification area the
            // shell notes it and closing the window quits as before, so the app can never become unreachable.
            shell::sync_tray_in_setup(app.handle());
            let behavior = app.state::<Shell>().behavior();

            // Keep the sign-in registration in step with the saved choice (covers installer-written settings,
            // moved installs and a changed executable path). Off the main thread: it may spawn reg.exe.
            std::thread::spawn(move || {
                if let Err(e) = shell::reconcile_autostart(behavior) {
                    eprintln!("[shell] start-at-sign-in not updated: {e}");
                }
            });

            if let Some(guard) = guard {
                let handle = app.handle().clone();
                guard.serve(move || shell::show_main(&handle));
            }

            // Window starts hidden (tauri.conf.json) so a sign-in launch never flashes it. It is shown unless this
            // launch was started by the OS in Startup mode with a working tray to restore it from.
            let stay_hidden = started_by_os && behavior == settings::Behavior::Startup && app.state::<Shell>().hides_on_close();
            if !stay_hidden {
                shell::show_main(app.handle());
            }

            // Startup: services start on a worker thread and the UI is told about every state change via
            // "services-status", so the dashboard can appear the moment the backend is ready.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let manager = app_handle.state::<ServiceManager>();
                let emit = |s: process::ServiceStatus| {
                    let _ = app_handle.emit("services-status", s);
                };
                manager.start(&app_handle, &emit);
            });

            // Native X close button: in a background mode the window hides and everything keeps running; otherwise
            // both services stop before the window actually closes, so Task Manager never shows a leftover
            // SystemMonitor.Api.exe after the app is gone. `prevent_close` + manual `app.exit()` turns the
            // otherwise-immediate close into "clean up, then close" without blocking the UI thread.
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let shell = app_handle.state::<Shell>();
                        if shell.hides_on_close() {
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        } else {
                            shell::quit(&app_handle);
                        }
                    }
                    // Deliberately no handling of Resized/Moved/Focused — minimize and maximize are plain native
                    // window-manager behavior and never reach services.
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SystemInfo");
}
