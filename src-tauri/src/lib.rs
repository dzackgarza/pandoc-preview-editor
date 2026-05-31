pub mod state;
pub mod config;
pub mod command_flags;
pub mod fs_utils;
pub mod render;
pub mod commands;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_state = config::build_initial_state();

    let mut builder = commands::register_commands(
        tauri::Builder::default()
            .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
            .plugin(tauri_plugin_shell::init())
            .plugin(tauri_plugin_fs::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_http::init())
            .manage(Mutex::new(initial_state)),
    );

    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_playwright::init());
    }

    builder
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
