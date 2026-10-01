// Real process supervision against fake HTTP services (python3 -m http-ish stub).
// Regression coverage for: status() blocking during startup (the window-freeze bug),
// waiting out the full timeout for a crashed child, a stale/foreign process on the
// port being mistaken for a healthy service, orphaned children, cancellation.
mod tests {
    use supervisor_tests::supervisor::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const FAKE: &str = r#"
import sys, time, http.server, socketserver
port, delay = int(sys.argv[1]), float(sys.argv[2])
time.sleep(delay)
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"status":"ok"}')
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", port), H).serve_forever()
"#;

    fn fake(port: u16, delay: f32) -> std::io::Result<Command> {
        let mut c = Command::new("python3");
        c.args(["-c", FAKE, &port.to_string(), &delay.to_string()]).stdout(Stdio::null()).stderr(Stdio::null());
        Ok(c)
    }
    fn launch(c: std::io::Result<Command>, secs: u64) -> Launch { Launch { command: c, timeout: Duration::from_secs(secs) } }
    fn sup(bp: u16, ap: u16) -> Supervisor {
        Supervisor::new(vec![Service::new("backend", bp, "python3"), Service::new("analytics", ap, "python3")])
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
        let dead = || { let mut c = Command::new("python3"); c.args(["-c", "import sys; sys.exit(3)"]); Ok(c) };
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
        let missing = Err(std::io::Error::new(std::io::ErrorKind::NotFound, "analytics not found in resources"));
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
        let s = Supervisor::new(vec![Service::new("backend", 18151, name), Service::new("analytics", 18152, name)]);
        let st = s.start(&logs, vec![launch(fake(18151, 0.0), 10), launch(fake(18152, 0.0), 10)], &|_| {});
        assert_eq!(st[0], ServiceHealth::Running, "stale process should have been cleaned up");
        assert!(stale.try_wait().unwrap().is_some(), "stale process still alive");
        s.stop(&logs);
    }
}
