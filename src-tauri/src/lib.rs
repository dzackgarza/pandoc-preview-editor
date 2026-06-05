pub mod command_flags;
pub mod commands;
pub mod config;
pub mod fs_utils;
pub mod render;
pub mod state;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_state = config::build_initial_state().unwrap_or_else(|error| {
        panic!("pandoc-preview fatal startup error: {}", error);
    });

    commands::register_commands(
        tauri::Builder::default()
            .plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_http::init())
            .plugin(tauri_plugin_playwright::init())
            .manage(Mutex::new(initial_state)),
    )
    .setup(|app| {
        use tauri::Manager;
        let windows = app.webview_windows();
        eprintln!("[DEBUG] Active windows ({}):", windows.len());
        for (label, _) in windows {
            eprintln!("[DEBUG]   - Window: {}", label);
        }
        Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
