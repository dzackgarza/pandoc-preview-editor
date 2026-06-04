use std::fs;
use std::sync::Mutex;

use tauri::State;

use crate::state::AppState;

// ─── pandoc assets ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn pandoc_assets(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let mut templates: Vec<String> = vec![];
    let mut filters: Vec<String> = vec![];

    let template_entries = fs::read_dir(&s.templates_dir).map_err(|e| {
        format!(
            "failed to read templates dir {}: {e}",
            s.templates_dir.display()
        )
    })?;
    for entry in template_entries {
        let entry = entry.map_err(|e| format!("failed to read templates dir entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if (name.ends_with(".html") || name.ends_with(".template")) && entry.path().is_file() {
            templates.push(name);
        }
    }

    let filter_entries = fs::read_dir(&s.filters_dir).map_err(|e| {
        format!(
            "failed to read filters dir {}: {e}",
            s.filters_dir.display()
        )
    })?;
    for entry in filter_entries {
        let entry = entry.map_err(|e| format!("failed to read filters dir entry: {e}"))?;
        if entry.path().is_file() {
            filters.push(entry.file_name().to_string_lossy().into_owned());
        }
    }

    Ok(serde_json::json!({ "templates": templates, "filters": filters }))
}
