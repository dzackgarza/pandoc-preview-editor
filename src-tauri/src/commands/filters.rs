use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::State;

use crate::command_flags::FilterEntry;
use crate::config::write_config_toml;
use crate::fs_utils::path_is_inside;
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

// ─── filters ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_filters(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let filters_dir = s.filters_dir.clone();

    let active: std::collections::HashSet<PathBuf> = s
        .parsed_flags
        .filters
        .iter()
        .map(|f| {
            let p = if f.path.starts_with("~/") {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("/tmp"))
                    .join(&f.path[2..])
            } else {
                PathBuf::from(&f.path)
            };
            if p.is_absolute() {
                p
            } else {
                std::env::current_dir().unwrap_or_default().join(p)
            }
        })
        .collect();

    let mut files: Vec<serde_json::Value> = vec![];
    if filters_dir.exists() {
        if let Ok(entries) = fs::read_dir(&filters_dir) {
            files = entries
                .flatten()
                .filter(|e| e.file_name().to_string_lossy().ends_with(".lua") && e.path().is_file())
                .map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let abs = filters_dir.join(&name);
                    let enabled = active.contains(&abs);
                    serde_json::json!({
                        "name": name,
                        "path": abs.to_string_lossy(),
                        "enabled": enabled,
                    })
                })
                .collect();
        }
    }

    Ok(serde_json::json!({ "filters": files }))
}

#[tauri::command]
pub fn toggle_filters(
    enabled: Vec<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut s = state.lock().unwrap();
    let filters_dir = s.filters_dir.clone();

    // Keep filters from parsed_flags that are NOT inside filters_dir
    let mut new_filters: Vec<FilterEntry> = s
        .parsed_flags
        .filters
        .iter()
        .filter(|f| {
            let p = if f.path.starts_with("~/") {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("/tmp"))
                    .join(&f.path[2..])
            } else {
                PathBuf::from(&f.path)
            };
            let resolved = if p.is_absolute() {
                p
            } else {
                std::env::current_dir().unwrap_or_default().join(p)
            };
            !path_is_inside(&filters_dir, &resolved)
        })
        .cloned()
        .collect();

    // Add newly enabled filters that live in filters_dir
    for item in &enabled {
        let filename = if item.ends_with(".lua") {
            Path::new(item)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| item.clone())
        } else {
            format!(
                "{}.lua",
                Path::new(item)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| item.clone())
            )
        };
        let path_opt = filters_dir.join(&filename);
        if !path_opt.is_file() {
            return Err(format!(
                "filter \"{}\" does not exist in {}",
                filename,
                filters_dir.display()
            ));
        }
        new_filters.push(FilterEntry {
            flag: "lua-filter".into(),
            path: path_opt.to_string_lossy().into_owned(),
        });
    }

    s.parsed_flags.filters = new_filters;
    let new_cmd = s.parsed_flags.reconstruct_command();
    s.render_command = new_cmd.clone();

    if let Some(ref config_path) = s.config_path.clone() {
        write_config_toml(
            config_path,
            s.debounce_ms,
            s.timeout_ms,
            true,
            &new_cmd,
            &s.templates_dir.to_string_lossy(),
            &s.filters_dir.to_string_lossy(),
        )?;
    }

    Ok(serde_json::json!({ "ok": true, "renderCommand": new_cmd }))
}
