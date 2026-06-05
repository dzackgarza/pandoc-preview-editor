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

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(Mutex::new(initial_state));

    #[cfg(feature = "e2e-testing")]
    let builder = {
        let socket_path = std::env::var("TAURI_PLAYWRIGHT_SOCKET")
            .expect("TAURI_PLAYWRIGHT_SOCKET must be set for e2e-testing builds");
        builder.plugin(tauri_plugin_playwright::init_with_config(
            tauri_plugin_playwright::PluginConfig::new()
                .socket_path(socket_path)
                .window_label("main"),
        ))
    };

    commands::register_commands(builder)
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
