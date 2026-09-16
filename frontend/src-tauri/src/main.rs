// All real logic lives in the library target (lib.rs) — standard Tauri 2
// project shape, keeps the binary crate trivial.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    system_info_lib::run();
}
