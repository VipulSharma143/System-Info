//! One running System Info per user. A tiny loopback handshake instead of a plugin, because the plugin's lock is held
//! until the old process is gone and so also blocks the app's own restart (reset data, update relaunch).
//!
//! First process: binds the port and serves. Later launches connect, say "show", and exit when answered "ok" (the
//! running app brings its window forward). A running app that is shutting down answers "closing", and a refused connection
//! means it is already gone; in both cases the new launch waits briefly and takes over, which is what makes restarts work.
//! Anything else on the port (or no answer in time) is not our app: start normally, unguarded.
//! std-only, so the protocol is tested with real sockets (see supervisor-tests).

use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const PORT: u16 = 47813;
const HELLO: &str = "SYSTEMINFO-SHOW 1";
const REPLY_OK: &str = "ok";
const REPLY_CLOSING: &str = "closing";
const IO_TIMEOUT: Duration = Duration::from_millis(600);
const RETRY_EVERY: Duration = Duration::from_millis(150);
/// How long a new launch waits for a closing instance to let go before starting anyway.
pub const TAKEOVER_WAIT: Duration = Duration::from_secs(10);

pub struct Guard {
    listener: TcpListener,
    closing: Arc<AtomicBool>,
}

pub enum Role {
    /// This process owns the port.
    Primary(Guard),
    /// Another System Info is running and has been asked to show its window: exit now.
    Secondary,
    /// The port could not be used; run normally without the single-instance guard.
    Unguarded,
}

enum Answer {
    Shown,
    Closing,
    Gone,
    Foreign,
}

fn ask(port: u16) -> Answer {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, IO_TIMEOUT) else { return Answer::Gone };
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    if writeln!(stream, "{HELLO}").is_err() {
        return Answer::Foreign;
    }
    let mut line = String::new();
    match BufReader::new(stream).read_line(&mut line) {
        Ok(0) => Answer::Gone,
        Ok(_) => match line.trim() {
            REPLY_OK => Answer::Shown,
            REPLY_CLOSING => Answer::Closing,
            _ => Answer::Foreign,
        },
        // The other process went away mid-conversation: that is the same as it being gone.
        Err(e) if matches!(e.kind(), ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted | ErrorKind::BrokenPipe | ErrorKind::UnexpectedEof) => Answer::Gone,
        Err(_) => Answer::Foreign,
    }
}

pub fn acquire(wait: Duration) -> Role {
    acquire_on(PORT, wait)
}

pub fn acquire_on(port: u16, wait: Duration) -> Role {
    let deadline = Instant::now() + wait;
    loop {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            Ok(listener) => return Role::Primary(Guard { listener, closing: Arc::new(AtomicBool::new(false)) }),
            Err(_) => match ask(port) {
                Answer::Shown => return Role::Secondary,
                Answer::Foreign => return Role::Unguarded,
                Answer::Closing | Answer::Gone => {
                    if Instant::now() >= deadline {
                        return Role::Unguarded;
                    }
                    std::thread::sleep(RETRY_EVERY);
                }
            },
        }
    }
}

impl Guard {
    /// Set when this process starts shutting down or restarting, so a new launch waits instead of exiting.
    pub fn closing_flag(&self) -> Arc<AtomicBool> {
        self.closing.clone()
    }

    /// Serves "show" requests on a background thread for the life of the process.
    pub fn serve(self, on_show: impl Fn() + Send + 'static) {
        std::thread::spawn(move || {
            for stream in self.listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
                let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
                let mut line = String::new();
                let Ok(_) = BufReader::new(&stream).read_line(&mut line) else { continue };
                if line.trim() != HELLO {
                    continue;
                }
                if self.closing.load(Ordering::SeqCst) {
                    let _ = writeln!(stream, "{REPLY_CLOSING}");
                } else {
                    on_show();
                    let _ = writeln!(stream, "{REPLY_OK}");
                }
            }
        });
    }
}
