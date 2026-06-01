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

    if s.templates_dir.exists() {
        if let Ok(entries) = fs::read_dir(&s.templates_dir) {
            templates = entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    (name.ends_with(".html") || name.ends_with(".template")) && e.path().is_file()
                })
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
        }
    }

    if s.filters_dir.exists() {
        if let Ok(entries) = fs::read_dir(&s.filters_dir) {
            filters = entries
                .flatten()
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
        }
    }

    Ok(serde_json::json!({ "templates": templates, "filters": filters }))
}
