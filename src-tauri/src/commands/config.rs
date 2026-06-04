use std::path::PathBuf;
use std::sync::Mutex;

use tauri::State;

use crate::command_flags;
use crate::config::write_config_toml;
use crate::state::AppState;

// ─── config ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_config(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let parsed = serde_json::to_value(&s.parsed_flags)
        .map_err(|e| format!("failed to serialize parsed command flags: {e}"))?;
    Ok(serde_json::json!({
        "templatesDir": s.templates_dir.to_string_lossy(),
        "filtersDir": s.filters_dir.to_string_lossy(),
        "debounceMs": s.debounce_ms,
        "timeoutMs": s.timeout_ms,
        "renderCommand": s.render_command,
        "restoreLastFile": s.restore_last_file,
        "parsedFlags": parsed,
    }))
}

#[tauri::command]
pub fn set_config(
    templates_dir: String,
    filters_dir: String,
    debounce_ms: u64,
    timeout_ms: u64,
    render_command: String,
    restore_last_file: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    if render_command.trim().is_empty() {
        return Err("renderCommand must be a non-empty shell command".into());
    }
    let mut s = state.lock().unwrap();
    let templates = PathBuf::from(&templates_dir);
    let filters = PathBuf::from(&filters_dir);

    s.templates_dir = templates;
    s.filters_dir = filters.clone();
    s.debounce_ms = debounce_ms;
    s.timeout_ms = timeout_ms;
    s.render_command = render_command.clone();
    s.parsed_flags = command_flags::parse_render_command(&render_command)?;
    s.restore_last_file = restore_last_file;

    if let Some(ref config_path) = s.config_path {
        write_config_toml(
            config_path,
            debounce_ms,
            timeout_ms,
            restore_last_file,
            &render_command,
            &templates_dir,
            &filters_dir,
        )?;
    }

    Ok(serde_json::json!({ "ok": true }))
}
