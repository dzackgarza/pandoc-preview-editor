use std::sync::Mutex;

use tauri::State;

use crate::command_flags;
use crate::config::{expand_config_path, validate_render_assets, write_config_toml};
use crate::state::AppState;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUpdate {
    pub templates_dir: String,
    pub filters_dir: String,
    pub figures_dir: String,
    pub debounce_ms: u64,
    pub timeout_ms: u64,
    pub render_command: String,
    pub restore_last_file: bool,
}

// ─── config ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_config(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let parsed = serde_json::to_value(&s.parsed_flags)
        .map_err(|e| format!("failed to serialize parsed command flags: {e}"))?;
    Ok(serde_json::json!({
        "templatesDir": s.templates_dir.to_string_lossy(),
        "filtersDir": s.filters_dir.to_string_lossy(),
        "figuresDir": s.figures_dir.to_string_lossy(),
        "debounceMs": s.debounce_ms,
        "timeoutMs": s.timeout_ms,
        "renderCommand": s.render_command,
        "restoreLastFile": s.restore_last_file,
        "parsedFlags": parsed,
    }))
}

#[tauri::command]
pub fn set_config(
    update: ConfigUpdate,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    if update.render_command.trim().is_empty() {
        return Err("renderCommand must be a non-empty shell command".into());
    }
    let templates = expand_config_path(&update.templates_dir)?;
    let filters = expand_config_path(&update.filters_dir)?;
    let figures = expand_config_path(&update.figures_dir)?;
    let parsed_flags = command_flags::parse_render_command(&update.render_command)?;
    validate_render_assets(&parsed_flags, &templates, &filters, &figures)?;

    let mut s = state.lock().unwrap();
    s.templates_dir = templates;
    s.filters_dir = filters.clone();
    s.figures_dir = figures.clone();
    s.debounce_ms = update.debounce_ms;
    s.timeout_ms = update.timeout_ms;
    s.render_command = update.render_command.clone();
    s.parsed_flags = parsed_flags;
    s.restore_last_file = update.restore_last_file;

    if let Some(ref config_path) = s.config_path {
        write_config_toml(
            config_path,
            update.debounce_ms,
            update.timeout_ms,
            update.restore_last_file,
            &update.render_command,
            &update.templates_dir,
            &update.filters_dir,
            &update.figures_dir,
        )?;
    }

    Ok(serde_json::json!({ "ok": true }))
}
