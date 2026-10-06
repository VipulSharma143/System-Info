// Real process supervision against fake HTTP services (src/bin/fake-service.rs, std-only).
// Regression coverage for: status() blocking during startup (the window-freeze bug),
// waiting out the full timeout for a crashed child, a stale/foreign process on the
// port being mistaken for a healthy service, orphaned children, cancellation.
mod tests {
    use supervisor_tests::supervisor::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const FAKE_EXE: &str = env!("CARGO_BIN_EXE_fake-service");

    fn fake(port: u16, delay: f32) -> std::io::Result<Command> {
        let mut c = Command::new(FAKE_EXE);
        c.args([&port.to_string(), &delay.to_string()]).stdout(Stdio::null()).stderr(Stdio::null());
        Ok(c)
    }
    fn launch(c: std::io::Result<Command>, secs: u64) -> Launch { Launch { command: c, timeout: Duration::from_secs(secs) } }
    fn sup(bp: u16, ap: u16) -> Supervisor {
        Supervisor::new(vec![Service::new("backend", bp, "fake-service"), Service::new("second", ap, "fake-service")])
    }
    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("suptest-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d); std::fs::create_dir_all(&d).unwrap(); d
    }

    #[test]
    fn concurrent_start_and_status_never_blocks() {
        let s = sup(18101, 18102); let logs = tmp("conc");
        let t = Instant::now();
        std::thread::scope(|sc| {
            let h = sc.spawn(|| s.start(&logs, vec![launch(fake(18101, 1.5), 10), launch(fake(18102, 1.5), 10)], &|_| {}));
            // THE REGRESSION: while start() is waiting, status() must return instantly.
            std::thread::sleep(Duration::from_millis(300));
            let mut worst = Duration::ZERO;
            for _ in 0..50 { let a = Instant::now(); let st = s.status(); worst = worst.max(a.elapsed()); assert_eq!(st[0], ServiceHealth::Starting); std::thread::sleep(Duration::from_millis(10)); }
            assert!(worst < Duration::from_millis(50), "status() blocked for {worst:?}");
            let st = h.join().unwrap();
            assert_eq!(st[0], ServiceHealth::Running); assert_eq!(st[1], ServiceHealth::Running);
        });
        // concurrent: ~1.5s+overhead, sequential would be >= 3s
        assert!(t.elapsed() < Duration::from_millis(2900), "not concurrent: {:?}", t.elapsed());
        let st = s.stop(&logs);
        assert_eq!(st[0], ServiceHealth::Stopped);
        std::thread::sleep(Duration::from_millis(300));
        assert!(port_free(18101) && port_free(18102), "child processes leaked after stop()");
    }

    #[test]
    fn early_exit_reported_fast_not_after_timeout() {
        let s = sup(18111, 18112); let logs = tmp("exit");
        let dead = || { let mut c = Command::new(FAKE_EXE); c.args(["exit", "3"]); Ok(c) };
        let t = Instant::now();
        let st = s.start(&logs, vec![launch(dead(), 30), launch(fake(18112, 0.2), 10)], &|_| {});
        assert!(t.elapsed() < Duration::from_secs(3), "waited {:?} for a dead process", t.elapsed());
        assert_eq!(st[0], ServiceHealth::Unavailable);
        assert_eq!(st[1], ServiceHealth::Running, "one failing service must not take the other down");
        s.stop(&logs);
        let log = std::fs::read_to_string(logs.join("startup.log")).unwrap();
        assert!(log.contains("exited during startup"), "{log}");
    }

    #[test]
    fn busy_port_is_not_mistaken_for_healthy_service() {
        let logs = tmp("busy");
        let mut foreign = fake(18121, 0.0).unwrap().spawn().unwrap(); // some other program answering /health
        std::thread::sleep(Duration::from_millis(600));
        let s = sup(18121, 18122);
        let st = s.start(&logs, vec![launch(fake(18121, 0.0), 10), launch(fake(18122, 0.0), 10)], &|_| {});
        assert_eq!(st[0], ServiceHealth::Unavailable);
        assert!(foreign.try_wait().unwrap().is_none(), "must not kill an unrelated process");
        assert_eq!(st[1], ServiceHealth::Running);
        s.stop(&logs); let _ = foreign.kill();
    }

    #[test]
    fn missing_executable_is_unavailable_not_a_hang() {
        let s = sup(18131, 18132); let logs = tmp("missing");
        let missing = Err(std::io::Error::new(std::io::ErrorKind::NotFound, "second service executable not found in resources"));
        let st = s.start(&logs, vec![launch(fake(18131, 0.0), 10), launch(missing, 10)], &|_| {});
        assert_eq!(st[0], ServiceHealth::Running);
        assert_eq!(st[1], ServiceHealth::Unavailable);
        s.stop(&logs);
    }

    #[test]
    fn stop_during_start_returns_promptly() {
        let s = sup(18141, 18142); let logs = tmp("cancel");
        std::thread::scope(|sc| {
            let h = sc.spawn(|| s.start(&logs, vec![launch(fake(18141, 5.0), 30), launch(fake(18142, 5.0), 30)], &|_| {}));
            std::thread::sleep(Duration::from_millis(500));
            let t = Instant::now(); s.stop(&logs);
            h.join().unwrap();
            assert!(t.elapsed() < Duration::from_secs(2), "stop/cancel took {:?}", t.elapsed());
        });
        std::thread::sleep(Duration::from_millis(300));
        assert!(port_free(18141) && port_free(18142));
    }

    #[cfg(unix)]
    #[test]
    fn stale_process_from_previous_run_is_replaced() {
        let logs = tmp("stale");
        let mut stale = fake(18151, 0.0).unwrap().spawn().unwrap();
        std::fs::write(logs.join("backend.pid"), stale.id().to_string()).unwrap();
        std::thread::sleep(Duration::from_millis(600));
        assert!(!port_free(18151));
        let exe = std::fs::read_link(format!("/proc/{}/exe", stale.id())).unwrap();
        let name: &'static str = Box::leak(exe.file_name().unwrap().to_string_lossy().into_owned().into_boxed_str());
        let s = Supervisor::new(vec![Service::new("backend", 18151, name), Service::new("second", 18152, name)]);
        let st = s.start(&logs, vec![launch(fake(18151, 0.0), 10), launch(fake(18152, 0.0), 10)], &|_| {});
        assert_eq!(st[0], ServiceHealth::Running, "stale process should have been cleaned up");
        assert!(stale.try_wait().unwrap().is_some(), "stale process still alive");
        s.stop(&logs);
    }

    // ---- Phase 1: update preparation. stop() alone is not proof that an installer may overwrite files. ----

    #[test]
    fn released_immediately_when_nothing_is_held() {
        let logs = tmp("rel-free");
        let file = logs.join("lib.so");
        std::fs::write(&file, b"x").unwrap();
        let r = wait_released(&[18141], &[file, logs.join("does-not-exist.dll")], Duration::from_secs(2));
        assert!(r.released, "{r:?}");
        assert!(r.waited_ms < 500, "a free system must not be waited on: {r:?}");
    }

    #[test]
    fn a_port_that_stays_busy_is_reported_not_ignored() {
        let _hold = std::net::TcpListener::bind(("127.0.0.1", 18142)).unwrap();
        let t = Instant::now();
        let r = wait_released(&[18142], &[], Duration::from_millis(400));
        assert!(!r.released && r.detail.contains("18142"), "{r:?}");
        assert!(t.elapsed() < Duration::from_secs(2), "the wait must be bounded");
    }

    #[test]
    fn a_port_freed_during_the_wait_ends_it_early() {
        let hold = std::net::TcpListener::bind(("127.0.0.1", 18143)).unwrap();
        let t = Instant::now();
        let r = std::thread::scope(|sc| {
            sc.spawn(move || { std::thread::sleep(Duration::from_millis(300)); drop(hold); });
            wait_released(&[18143], &[], Duration::from_secs(5))
        });
        assert!(r.released, "{r:?}");
        assert!(t.elapsed() < Duration::from_secs(2), "released as soon as the port freed, not at the timeout: {:?}", t.elapsed());
    }

    #[cfg(unix)]
    #[test]
    fn a_running_executable_counts_as_locked_until_it_exits() {
        // Copy the fake service so the file under test is only ever this test's own process.
        let dir = tmp("rel-lock");
        let exe = dir.join("running-copy");
        std::fs::copy(FAKE_EXE, &exe).unwrap();
        let mut child = Command::new(&exe).args(["18144", "0.1"]).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert!(is_locked(&exe), "a running executable cannot be overwritten");
        let blocked = wait_released(&[], std::slice::from_ref(&exe), Duration::from_millis(300));
        assert!(!blocked.released && blocked.detail.contains("running-copy"), "{blocked:?}");
        child.kill().unwrap(); child.wait().unwrap();
        let free = wait_released(&[18144], std::slice::from_ref(&exe), Duration::from_secs(3));
        assert!(free.released, "once the process is gone the file is free: {free:?}");
    }

    #[test]
    fn stop_and_wait_released_leaves_nothing_behind_and_logs_it() {
        let s = sup(18145, 18146); let logs = tmp("rel-stop");
        let st = s.start(&logs, vec![launch(fake(18145, 0.2), 10), launch(fake(18146, 0.2), 10)], &|_| {});
        assert_eq!(st[0], ServiceHealth::Running);
        let (status, report) = s.stop_and_wait_released(&logs, &[], Duration::from_secs(5));
        assert_eq!(status[0], ServiceHealth::Stopped);
        assert!(report.released, "{report:?}");
        assert!(port_free(18145) && port_free(18146));
        let log = std::fs::read_to_string(logs.join("update.log")).unwrap();
        assert!(log.contains("released=true"), "{log}");
    }
}
