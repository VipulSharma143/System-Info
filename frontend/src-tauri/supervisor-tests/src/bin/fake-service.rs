// Fake HTTP service used by tests/supervisor.rs. std-only on purpose: the
// supervisor-tests crate has no dependencies, so `cargo test` needs nothing
// but cargo.
//
// Usage:
//   fake-service <port> <delay_secs>   wait <delay_secs> (float; the port stays
//                                      closed meanwhile, so the supervisor sees
//                                      "starting"), then listen on 127.0.0.1:<port>
//                                      and answer every request with HTTP 200
//   fake-service exit <code>           exit immediately with <code> (a service
//                                      that dies during startup)
//
// It runs until it is killed, which is how the supervisor stops its children.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::time::Duration;

const RESPONSE: &[u8] =
    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";

fn usage() -> ! {
    eprintln!("usage: fake-service <port> <delay_secs> | fake-service exit <code>");
    std::process::exit(2);
}

fn handle(mut stream: TcpStream) {
    // A client that connects and says nothing (the supervisor's port probes do
    // exactly that) must never wedge this thread.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));

    let mut buf = [0u8; 1024];
    let _ = stream.read(&mut buf);
    let _ = stream.write_all(RESPONSE);
    let _ = stream.flush();
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.first().map(String::as_str) == Some("exit") {
        let code: i32 = args.get(1).and_then(|c| c.parse().ok()).unwrap_or(1);
        std::process::exit(code);
    }

    let port: u16 = args.first().and_then(|p| p.parse().ok()).unwrap_or_else(|| usage());
    let delay: f32 = args.get(1).and_then(|d| d.parse().ok()).unwrap_or(0.0);

    // Duration::from_secs_f32 panics on negative, NaN or absurd values.
    if delay.is_finite() && delay > 0.0 && delay < 3600.0 {
        std::thread::sleep(Duration::from_secs_f32(delay));
    }

    let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("fake-service: cannot bind 127.0.0.1:{port}: {e}");
            std::process::exit(1);
        }
    };

    for stream in listener.incoming().flatten() {
        std::thread::spawn(move || handle(stream));
    }
}
