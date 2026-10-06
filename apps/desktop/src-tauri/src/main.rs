// Prevents an extra console window on Windows in release builds (Tauri 2 template).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    postit_desktop::run()
}
