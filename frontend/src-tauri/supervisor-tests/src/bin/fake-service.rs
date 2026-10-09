// Std-only stand-in for the backend / second service, used by the supervisor tests.
//
//   fake-service <port> <delay-seconds>   wait, then listen on 127.0.0.1:<port> and answer GET /health with 200
//   fake-service exit <code>              exit immediately with that code (a service that dies during startup)
//
// The delay is how the tests keep a service "starting" for a while; nothing listens until it has passed, so the
// supervisor must wait for readiness instead of assuming it. The process runs until it is killed.
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::time::Duration;

fn answer(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = [0u8; 512];
    let _ = stream.read(&mut buf);
    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("exit") {
        std::process::exit(args.get(1).and_then(|c| c.parse().ok()).unwrap_or(1));
    }

    let port: u16 = args.first().and_then(|p| p.parse().ok()).unwrap_or_else(|| {
        eprintln!("usage: fake-service <port> <delay-seconds> | exit <code>");
        std::process::exit(2);
    });
    let delay: f32 = args.get(1).and_then(|d| d.parse().ok()).unwrap_or(0.0);
    if delay > 0.0 {
        std::thread::sleep(Duration::from_secs_f32(delay));
    }

    let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("cannot listen on {port}: {e}");
            std::process::exit(3);
        }
    };
    for conn in listener.incoming().flatten() {
        std::thread::spawn(move || answer(conn));
    }
}
