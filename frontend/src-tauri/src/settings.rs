//! The one user preference the shell owns: what System Info does when its window is closed and when the computer
//! starts. Stored as `<data root>/settings.json` (the folder the backend's `data/` and `logs/` live in; Reset data
//! never touches it). std-only so it is unit-tested without Tauri (see supervisor-tests).
//!
//! Fresh install vs. update is decided here, once, by what is already on disk:
//!   - `settings.json` present and readable  -> use it (the Windows installer writes it after asking the user);
//!   - absent, but the data folder already has content -> an existing installation that is being updated: keep the
//!     old behaviour (`Off`, close quits) and never ask;
//!   - absent and nothing there -> a fresh installation: store `Off` with `firstRunPending` so the first-launch
//!     dialog asks exactly once, even if the app is closed before the user answers.

use std::io;
use std::path::{Path, PathBuf};

pub const FILE_NAME: &str = "settings.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Behavior {
    /// Closing the window keeps the app running in the tray.
    Background,
    /// Closing the window quits (the behaviour of every release before the preference existed).
    Off,
    /// Starts at sign-in, hidden in the tray, and keeps running in the tray when the window is closed.
    Startup,
}

impl Behavior {
    pub fn as_str(self) -> &'static str {
        match self {
            Behavior::Background => "background",
            Behavior::Off => "off",
            Behavior::Startup => "startup",
        }
    }

    pub fn parse(text: &str) -> Option<Behavior> {
        match text {
            "background" => Some(Behavior::Background),
            "off" => Some(Behavior::Off),
            "startup" => Some(Behavior::Startup),
            _ => None,
        }
    }

    /// Both background modes need the tray icon; `Off` never does.
    pub fn runs_in_background(self) -> bool {
        self != Behavior::Off
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Settings {
    pub behavior: Behavior,
    /// True on a fresh installation until the user has answered the first-launch question.
    pub first_run_pending: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    Existing(Settings),
    /// An installation from before the preference existed (an update): keep the old behaviour, do not ask.
    Legacy,
    Fresh,
}

pub fn path(root: &Path) -> PathBuf {
    root.join(FILE_NAME)
}

pub fn to_json(s: Settings) -> String {
    let pending = if s.first_run_pending { ",\"firstRunPending\":true" } else { "" };
    format!("{{\"schema\":1,\"behavior\":\"{}\"{}}}\n", s.behavior.as_str(), pending)
}

/// The text after `"key"` and its colon, with leading whitespace removed.
fn value_after<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\"{key}\"");
    let rest = &text[text.find(&needle)? + needle.len()..];
    Some(rest.trim_start().strip_prefix(':')?.trim_start())
}

/// Reads the file's own format (and whitespace variations of it). Unknown or missing behaviour -> None.
pub fn parse(text: &str) -> Option<Settings> {
    let value = value_after(text, "behavior")?.strip_prefix('"')?;
    let behavior = Behavior::parse(&value[..value.find('"')?])?;
    let first_run_pending = value_after(text, "firstRunPending").is_some_and(|v| v.starts_with("true"));
    Some(Settings { behavior, first_run_pending })
}

pub fn classify(root: &Path) -> Origin {
    match std::fs::read_to_string(path(root)) {
        Ok(text) => return parse(&text).map_or(Origin::Legacy, Origin::Existing),
        Err(e) if e.kind() != io::ErrorKind::NotFound => return Origin::Legacy,
        Err(_) => {}
    }
    let has_content = std::fs::read_dir(root).map(|mut d| d.next().is_some()).unwrap_or(false);
    if has_content { Origin::Legacy } else { Origin::Fresh }
}

/// Atomic: write a temp file, then rename over the real one, so a crash never leaves half a file.
pub fn save(root: &Path, s: Settings) -> io::Result<()> {
    std::fs::create_dir_all(root)?;
    let target = path(root);
    let tmp = root.join(format!("{FILE_NAME}.tmp"));
    std::fs::write(&tmp, to_json(s))?;
    std::fs::rename(&tmp, &target).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Resolves the starting settings and writes them down when this launch is the one that decides them.
pub fn load_or_initialise(root: &Path) -> Settings {
    let (settings, write) = match classify(root) {
        Origin::Existing(s) => (s, false),
        Origin::Legacy => (Settings { behavior: Behavior::Off, first_run_pending: false }, true),
        Origin::Fresh => (Settings { behavior: Behavior::Off, first_run_pending: true }, true),
    };
    if write {
        // Failing to write only means the same decision is made again next launch; never block startup on it.
        let _ = save(root, settings);
    }
    settings
}
