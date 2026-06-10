pub mod config;
pub mod diagram;
pub mod document;
pub mod figures;
pub mod filters;
pub mod plugins;
pub mod zotero;

pub fn register_commands(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        document::get_initial_state,
        crate::render::render,
        document::save,
        document::backup,
        document::browse,
        document::list_files,
        document::quick_open_spawn,
        document::file_content,
        document::file_exists,
        document::new_file,
        document::open_file_external,
        filters::pandoc_assets,
        config::get_config,
        config::set_config,
        zotero::zotero_cite,
        diagram::diagram_proxy,
        diagram::get_diagram_tools,
        diagram::create_diagram_file,
        diagram::launch_diagram,
        figures::save_figure_asset,
        figures::figures_registry,
        plugins::list_plugins,
        plugins::run_plugin,
    ])
}
