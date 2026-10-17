// Behaviour preference, start-at-sign-in entry and single-instance handshake: the std-only parts of the shell.
mod settings_tests {
    use supervisor_tests::settings::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("shelltest-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn json_round_trips_every_behavior() {
        for b in [Behavior::Background, Behavior::Off, Behavior::Startup] {
            for pending in [false, true] {
                let s = Settings { behavior: b, first_run_pending: pending };
                assert_eq!(parse(&to_json(s)), Some(s));
            }
        }
    }

    #[test]
    fn parse_tolerates_whitespace_and_rejects_unknown_values() {
        assert_eq!(parse("{ \"behavior\" : \"startup\" }"), Some(Settings { behavior: Behavior::Startup, first_run_pending: false }));
        assert_eq!(parse("{\"behavior\":\"sometimes\"}"), None);
        assert_eq!(parse("{}"), None);
        assert_eq!(parse("not json"), None);
    }

    #[test]
    fn empty_or_missing_folder_is_a_fresh_install() {
        let root = tmp("fresh");
        assert_eq!(classify(&root), Origin::Fresh);
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(classify(&root), Origin::Fresh);
    }

    #[test]
    fn existing_data_without_settings_is_an_update_and_is_not_asked() {
        let root = tmp("legacy");
        std::fs::create_dir_all(root.join("logs")).unwrap();
        assert_eq!(classify(&root), Origin::Legacy);
        let s = load_or_initialise(&root);
        assert_eq!(s, Settings { behavior: Behavior::Off, first_run_pending: false });
        // decided once: the next launch reads it back instead of deciding again
        assert_eq!(classify(&root), Origin::Existing(s));
    }

    #[test]
    fn fresh_install_asks_until_answered_even_across_restarts() {
        let root = tmp("ask");
        let first = load_or_initialise(&root);
        assert!(first.first_run_pending);
        let again = load_or_initialise(&root); // closed before answering; logs etc. now exist
        assert!(again.first_run_pending, "the question must survive a restart");
        save(&root, Settings { behavior: Behavior::Background, first_run_pending: false }).unwrap();
        assert_eq!(load_or_initialise(&root), Settings { behavior: Behavior::Background, first_run_pending: false });
    }

    #[test]
    fn installer_written_file_is_used_and_never_asked_again() {
        let root = tmp("installer");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(path(&root), "{\"schema\":1,\"behavior\":\"startup\"}\n").unwrap();
        assert_eq!(load_or_initialise(&root), Settings { behavior: Behavior::Startup, first_run_pending: false });
    }

    #[test]
    fn unreadable_file_keeps_the_old_behavior_instead_of_asking() {
        let root = tmp("corrupt");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(path(&root), "garbage").unwrap();
        assert_eq!(classify(&root), Origin::Legacy);
    }

    #[test]
    fn only_the_two_background_modes_use_the_tray() {
        assert!(Behavior::Background.runs_in_background());
        assert!(Behavior::Startup.runs_in_background());
        assert!(!Behavior::Off.runs_in_background());
    }
}

mod autostart_tests {
    use std::path::{Path, PathBuf};
    use supervisor_tests::autostart::*;

    #[test]
    fn windows_run_value_quotes_the_path() {
        assert_eq!(run_command(r"C:\Users\Vipul Sharma\AppData\Local\SystemInfo\SystemInfo.exe"), r#""C:\Users\Vipul Sharma\AppData\Local\SystemInfo\SystemInfo.exe" --autostart"#);
    }

    #[test]
    fn desktop_exec_quotes_only_when_needed() {
        assert_eq!(desktop_exec_quote("/usr/bin/system-info"), "/usr/bin/system-info");
        assert_eq!(desktop_exec_quote("/opt/My Apps/system info"), "\"/opt/My Apps/system info\"");
        assert!(desktop_entry("/usr/bin/system-info").contains("Exec=/usr/bin/system-info --autostart\n"));
        assert!(desktop_entry("/home/a/100%/x").contains("Exec=/home/a/100%%/x --autostart"));
    }

    #[test]
    fn entry_path_follows_xdg_then_home() {
        assert_eq!(linux_entry_path(Some(PathBuf::from("/cfg")), Some(PathBuf::from("/home/u"))), Some(PathBuf::from("/cfg/autostart/systeminfo.desktop")));
        assert_eq!(linux_entry_path(None, Some(PathBuf::from("/home/u"))), Some(PathBuf::from("/home/u/.config/autostart/systeminfo.desktop")));
        assert_eq!(linux_entry_path(Some(PathBuf::from("")), Some(PathBuf::from("/home/u"))), Some(PathBuf::from("/home/u/.config/autostart/systeminfo.desktop")));
        assert_eq!(linux_entry_path(None, None), None);
    }

    #[test]
    fn apply_creates_and_removes_the_entry() {
        let dir = std::env::temp_dir().join(format!("autostart-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let entry = dir.join("autostart").join("systeminfo.desktop");
        apply_to(true, Path::new("/usr/bin/system-info"), &entry).unwrap();
        assert!(std::fs::read_to_string(&entry).unwrap().contains("--autostart"));
        apply_to(false, Path::new("/usr/bin/system-info"), &entry).unwrap();
        assert!(!entry.exists());
        apply_to(false, Path::new("/usr/bin/system-info"), &entry).unwrap(); // already off: not an error
    }
}

mod instance_tests {
    use std::sync::atomic::Ordering;
    use std::sync::mpsc;
    use std::time::Duration;
    use supervisor_tests::instance::*;

    fn primary(port: u16) -> Guard {
        match acquire_on(port, Duration::ZERO) {
            Role::Primary(g) => g,
            _ => panic!("expected to own the port"),
        }
    }

    #[test]
    fn second_launch_asks_the_first_to_show_and_exits() {
        let port = 18161;
        let guard = primary(port);
        let (tx, rx) = mpsc::channel();
        guard.serve(move || tx.send(()).unwrap());
        assert!(matches!(acquire_on(port, Duration::from_secs(2)), Role::Secondary));
        rx.recv_timeout(Duration::from_secs(2)).expect("the running app was told to show its window");
    }

    #[test]
    fn a_closing_instance_does_not_swallow_the_restart() {
        let port = 18162;
        let guard = primary(port);
        let closing = guard.closing_flag();
        guard.serve(|| panic!("a closing app must not be asked to show"));
        closing.store(true, Ordering::SeqCst);
        // Still bound and answering "closing": the new launch waits, then gives up after the deadline and runs unguarded.
        assert!(matches!(acquire_on(port, Duration::from_millis(600)), Role::Unguarded));
    }

    #[test]
    fn a_restart_takes_over_once_the_old_process_lets_go() {
        let port = 18163;
        let old = primary(port);
        let closing = old.closing_flag();
        closing.store(true, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel::<()>();
        // The "old process" serves, then exits shortly after (its listener thread dies with the process; here the thread ends when the channel does).
        std::thread::spawn(move || {
            let listener_guard = old;
            rx.recv().ok();
            drop(listener_guard);
        });
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            tx.send(()).unwrap();
        });
        assert!(matches!(acquire_on(port, Duration::from_secs(5)), Role::Primary(_)));
    }

    #[test]
    fn something_else_on_the_port_is_not_our_app() {
        let port = 18164;
        let other = std::net::TcpListener::bind(("127.0.0.1", port)).unwrap();
        std::thread::spawn(move || {
            for s in other.incoming() {
                use std::io::Write;
                if let Ok(mut s) = s {
                    let _ = s.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
                }
            }
        });
        let started = std::time::Instant::now();
        assert!(matches!(acquire_on(port, Duration::from_secs(5)), Role::Unguarded));
        assert!(started.elapsed() < Duration::from_secs(2), "a foreign service must not delay startup");
    }
}
