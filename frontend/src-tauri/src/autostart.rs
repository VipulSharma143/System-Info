//! Start-at-sign-in registration, for the `Startup` behaviour. No extra crates: Windows uses the per-user Run key
//! through the always-present `reg.exe`, Linux an XDG autostart entry. The installer (Windows) writes the same value,
//! and the app reconciles it on every launch, so `settings.json` stays the single source of truth.
//! The pure formatting helpers are unit-tested without Tauri (see supervisor-tests).

use std::io;
use std::path::{Path, PathBuf};

/// Passed by the OS at sign-in; the app starts hidden in the tray when it sees this and the behaviour is `Startup`.
pub const AUTOSTART_ARG: &str = "--autostart";
#[cfg_attr(not(windows), allow(dead_code))]
pub const RUN_VALUE_NAME: &str = "SystemInfo";
pub const DESKTOP_FILE: &str = "systeminfo.desktop";

/// The command line stored in the Windows Run key.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn run_command(exe: &str) -> String {
    format!("\"{exe}\" {AUTOSTART_ARG}")
}

/// Quotes one argument for the `Exec=` line of a desktop entry (freedesktop.org Desktop Entry spec).
pub fn desktop_exec_quote(arg: &str) -> String {
    const SPECIAL: &[char] = &[' ', '\t', '\n', '"', '\'', '\\', '>', '<', '~', '|', '&', ';', '$', '*', '?', '#', '(', ')', '`'];
    if !arg.chars().any(|c| SPECIAL.contains(&c)) {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    for c in arg.chars() {
        if matches!(c, '"' | '`' | '$' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

/// Literal `%` must be doubled in `Exec=`.
fn desktop_exec_escape_percent(s: &str) -> String {
    s.replace('%', "%%")
}

pub fn desktop_entry(exe: &str) -> String {
    let exec = desktop_exec_escape_percent(&desktop_exec_quote(exe));
    format!(
        "[Desktop Entry]\nType=Application\nName=System Info\nComment=Start System Info in the background at sign-in\nExec={exec} {AUTOSTART_ARG}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
    )
}

/// `$XDG_CONFIG_HOME/autostart` or `~/.config/autostart`.
pub fn linux_entry_path(config_home: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    let base = config_home.filter(|p| !p.as_os_str().is_empty()).or_else(|| home.filter(|p| !p.as_os_str().is_empty()).map(|h| h.join(".config")))?;
    Some(base.join("autostart").join(DESKTOP_FILE))
}

/// The executable to register. An AppImage runs from a temporary mount that changes every launch, so its own file is used.
pub fn registered_exe() -> io::Result<PathBuf> {
    if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(appimage));
    }
    std::env::current_exe()
}

#[cfg(windows)]
pub fn apply(enabled: bool, exe: &Path) -> io::Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

    let mut cmd = Command::new("reg");
    cmd.creation_flags(CREATE_NO_WINDOW);
    if enabled {
        // raw_arg: the value itself contains quotes (the exe path may hold spaces), so it is passed exactly as reg.exe expects.
        let data = format!("\"{}\"", run_command(&exe.to_string_lossy()).replace('"', "\\\""));
        cmd.args(["add", RUN_KEY, "/v", RUN_VALUE_NAME, "/t", "REG_SZ", "/f", "/d"]).raw_arg(data);
    } else {
        cmd.args(["delete", RUN_KEY, "/v", RUN_VALUE_NAME, "/f"]);
    }
    let out = cmd.output()?;
    // Deleting a value that is not there is already the wanted state.
    if out.status.success() || !enabled {
        Ok(())
    } else {
        Err(io::Error::other(format!("reg.exe failed: {}", String::from_utf8_lossy(&out.stderr).trim())))
    }
}

#[cfg(not(windows))]
pub fn apply(enabled: bool, exe: &Path) -> io::Result<()> {
    let config_home = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let entry = linux_entry_path(config_home, home).ok_or_else(|| io::Error::other("no home folder to put the autostart entry in"))?;
    apply_to(enabled, exe, &entry)
}

/// Linux implementation with the entry path injected, so it can be tested against a temp folder.
#[cfg_attr(windows, allow(dead_code))]
pub fn apply_to(enabled: bool, exe: &Path, entry: &Path) -> io::Result<()> {
    if enabled {
        if let Some(dir) = entry.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(entry, desktop_entry(&exe.to_string_lossy()))
    } else {
        match std::fs::remove_file(entry) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }
}
