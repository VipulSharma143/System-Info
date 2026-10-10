// Release builds for Windows ask for administrator rights through the standard UAC prompt (the embedded manifest says
// requireAdministrator). The backend and its helper processes are children of this app and inherit the elevated token, so
// the one prompt at launch covers everything; nothing prompts again. Windows only lets the hardware-sensor driver read
// CPU temperatures from an elevated process.
//
// Debug builds (`tauri dev`) are NOT elevated on purpose: an elevated manifest makes `cargo run` fail with "requires
// elevation" (os error 740) from a normal terminal.
fn main() {
    let attributes = tauri_build::Attributes::new();

    let target_is_windows = std::env::var("CARGO_CFG_TARGET_OS").map(|os| os == "windows").unwrap_or(false);
    let is_release = std::env::var("PROFILE").map(|p| p == "release").unwrap_or(false);

    let attributes = if target_is_windows && is_release {
        attributes.windows_attributes(
            tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml")),
        )
    } else {
        attributes
    };

    tauri_build::try_build(attributes).expect("failed to run the Tauri build script");
}
