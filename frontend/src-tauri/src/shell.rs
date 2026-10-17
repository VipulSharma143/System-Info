//! Background behaviour of the desktop shell: the saved preference, the tray icon, what closing the window does,
//! and start-at-sign-in registration. The std-only decisions live in settings.rs / autostart.rs / instance.rs.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::autostart;
use crate::process::{self, ServiceManager};
use crate::settings::{self, Behavior, Settings};

const TRAY_ID: &str = "main";

pub struct Shell {
    root: PathBuf,
    settings: Mutex<Settings>,
    tray_ok: AtomicBool,
    /// A tray was attempted and the desktop refused it (no notification area): closing must quit instead of hiding.
    tray_failed: AtomicBool,
    /// Set when the process is shutting down or restarting; a new launch then waits for it instead of exiting.
    closing: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorReply {
    pub behavior: &'static str,
    pub first_run: bool,
    pub tray_available: bool,
}

impl Shell {
    pub fn new(root: PathBuf, settings: Settings, closing: Arc<AtomicBool>) -> Self {
        Self { root, settings: Mutex::new(settings), tray_ok: AtomicBool::new(false), tray_failed: AtomicBool::new(false), closing }
    }

    fn current(&self) -> Settings {
        *self.settings.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn behavior(&self) -> Behavior {
        self.current().behavior
    }

    pub fn reply(&self) -> BehaviorReply {
        let s = self.current();
        BehaviorReply { behavior: s.behavior.as_str(), first_run: s.first_run_pending, tray_available: !self.tray_failed.load(Ordering::SeqCst) }
    }

    pub fn mark_closing(&self) {
        self.closing.store(true, Ordering::SeqCst);
    }

    /// Closing the window hides it only when a background mode is chosen AND the tray exists to bring it back.
    pub fn hides_on_close(&self) -> bool {
        self.behavior().runs_in_background() && self.tray_ok.load(Ordering::SeqCst) && !self.closing.load(Ordering::SeqCst)
    }
}

/// Brings the main window forward (from the tray, or from a second launch).
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Full shutdown (services, then the app): the tray's Quit and the in-app Exit.
pub fn quit(app: &AppHandle) {
    app.state::<Shell>().mark_closing();
    let app = app.clone();
    std::thread::spawn(move || {
        process::shutdown(&app.state::<ServiceManager>());
        app.exit(0);
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show System Info", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit System Info", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit_item])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("System Info")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Creates or removes the tray icon so it exists exactly while a background mode is chosen. Must run on the main thread.
fn sync_tray_on_main(app: &AppHandle, want: bool) {
    let shell = app.state::<Shell>();
    let exists = app.tray_by_id(TRAY_ID).is_some();
    if want && !exists {
        match build_tray(app) {
            Ok(()) => {
                shell.tray_ok.store(true, Ordering::SeqCst);
                shell.tray_failed.store(false, Ordering::SeqCst);
            }
            Err(e) => {
                eprintln!("[shell] tray icon unavailable: {e}");
                shell.tray_ok.store(false, Ordering::SeqCst);
                shell.tray_failed.store(true, Ordering::SeqCst);
            }
        }
    } else if !want && exists {
        let _ = app.remove_tray_by_id(TRAY_ID);
        shell.tray_ok.store(false, Ordering::SeqCst);
    }
}

/// Startup path: `setup` already runs on the main thread.
pub fn sync_tray_in_setup(app: &AppHandle) {
    sync_tray_on_main(app, app.state::<Shell>().behavior().runs_in_background());
}

/// Command path: hop to the main thread (GTK requires it) and wait briefly for the result.
fn sync_tray_from_worker(app: &AppHandle, want: bool) {
    let (tx, rx) = mpsc::channel();
    let handle = app.clone();
    if app.run_on_main_thread(move || { sync_tray_on_main(&handle, want); let _ = tx.send(()); }).is_ok() {
        let _ = rx.recv_timeout(Duration::from_secs(5));
    }
}

/// Makes the start-at-sign-in registration match the preference. Failures are logged, never fatal.
pub fn reconcile_autostart(behavior: Behavior) -> Result<(), String> {
    let exe = autostart::registered_exe().map_err(|e| format!("could not find the app's own path: {e}"))?;
    autostart::apply(behavior == Behavior::Startup, &exe).map_err(|e| e.to_string())
}

/// Saves a new choice. The sign-in registration is changed first: if that fails nothing is saved, so the stored
/// preference and the real system state can never disagree.
pub fn set_behavior(app: &AppHandle, behavior: Behavior) -> Result<BehaviorReply, String> {
    let shell = app.state::<Shell>();
    reconcile_autostart(behavior).map_err(|e| format!("start-at-sign-in could not be updated: {e}"))?;
    let next = Settings { behavior, first_run_pending: false };
    settings::save(&shell.root, next).map_err(|e| format!("the setting could not be saved: {e}"))?;
    *shell.settings.lock().unwrap_or_else(|e| e.into_inner()) = next;
    sync_tray_from_worker(app, behavior.runs_in_background());
    Ok(shell.reply())
}
