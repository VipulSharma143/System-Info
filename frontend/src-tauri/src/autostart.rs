//! Start-at-sign-in registration, for the `Startup` behaviour. No extra crates.
//!
//! Windows: release builds require administrator rights (manifest), and Windows does NOT start an
//! elevation-requiring program from the Run key at sign-in. So the registration is a scheduled task ("SystemInfo",
//! at logon, highest privileges, not stopped on battery) created with `schtasks`; only an elevated app can create it,
//! which the app is. If that fails (an unelevated development run) the per-user Run key is used instead. The
//! installer does not register anything itself: it stores the choice in settings.json and the app registers on launch.
//! Linux: an XDG autostart entry. `settings.json` stays the single source of truth; the app reconciles on every launch.
//! The pure formatting helpers are unit-tested without Tauri (see supervisor-tests).

use std::io;
use std::path::{Path, PathBuf};

/// Passed by the OS at sign-in; the app starts hidden in the tray when it sees this and the behaviour is `Startup`.
pub const AUTOSTART_ARG: &str = "--autostart";
#[cfg_attr(not(windows), allow(dead_code))]
pub const RUN_VALUE_NAME: &str = "SystemInfo";
#[cfg_attr(not(windows), allow(dead_code))]
pub const TASK_NAME: &str = "SystemInfo";
pub const DESKTOP_FILE: &str = "systeminfo.desktop";

/// The command line stored in the Windows Run key.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn run_command(exe: &str) -> String {
    format!("\"{exe}\" {AUTOSTART_ARG}")
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The scheduled-task definition for Windows: at sign-in of the current user, highest privileges, no battery or time limits.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn task_xml(exe: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\n<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\n  <RegistrationInfo><Description>Starts System Info in the background at sign-in.</Description></RegistrationInfo>\n  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>\n  <Principals><Principal id=\"Author\"><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>\n  <Settings>\n    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\n    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\n    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\n    <Enabled>true</Enabled>\n  </Settings>\n  <Actions Context=\"Author\"><Exec><Command>{}</Command><Arguments>{AUTOSTART_ARG}</Arguments></Exec></Actions>\n</Task>\n",
        xml_escape(exe)
    )
}

/// UTF-16 little-endian with a byte-order mark: the encoding `schtasks /XML` always accepts.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn utf16le_with_bom(text: &str) -> Vec<u8> {
    let mut out = vec![0xFF, 0xFE];
    for unit in text.encode_utf16() {
        out.extend_from_slice(&unit.to_le_bytes());
    }
    out
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
fn hidden(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

#[cfg(windows)]
fn set_run_key(enabled: bool, exe: &Path) -> io::Result<()> {
    use std::os::windows::process::CommandExt;
    let mut cmd = hidden("reg");
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

#[cfg(windows)]
fn set_task(enabled: bool, exe: &Path) -> io::Result<()> {
    if !enabled {
        // Missing task = already off.
        let _ = hidden("schtasks").args(["/Delete", "/TN", TASK_NAME, "/F"]).output()?;
        return Ok(());
    }
    let xml_path = std::env::temp_dir().join(format!("systeminfo-task-{}.xml", std::process::id()));
    std::fs::write(&xml_path, utf16le_with_bom(&task_xml(&exe.to_string_lossy())))?;
    let result = hidden("schtasks").args(["/Create", "/TN", TASK_NAME, "/XML"]).arg(&xml_path).arg("/F").output();
    let _ = std::fs::remove_file(&xml_path);
    let out = result?;
    if out.status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!("schtasks failed: {}", String::from_utf8_lossy(&out.stderr).trim())))
    }
}

#[cfg(windows)]
pub fn apply(enabled: bool, exe: &Path) -> io::Result<()> {
    if !enabled {
        let task = set_task(false, exe);
        let run = set_run_key(false, exe);
        return task.and(run);
    }
    match set_task(true, exe) {
        // The task is the registration; a leftover Run entry (older versions, the fallback) must go or it would start a second copy.
        Ok(()) => set_run_key(false, exe),
        // Not elevated (development run): the Run key works for a program that needs no elevation.
        Err(task_error) => {
            eprintln!("[shell] scheduled task not created ({task_error}); using the Run key instead");
            set_run_key(true, exe)
        }
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
