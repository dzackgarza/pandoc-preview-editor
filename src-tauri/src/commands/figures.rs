use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tauri::State;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::fs_utils::{image_extension, normalize_path, path_is_inside, sanitize_figure_filename};
use crate::state::{tool_id_for_ext, AppState};

#[derive(Debug, Clone, serde::Serialize)]
pub struct FigureEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

// ─── figures assets ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_figure_asset(
    content_base64: String,
    _document_path: String,
    filename: Option<String>,
    mime_type: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    if !mime_type.starts_with("image/") {
        return Err("mimeType must be an image type".into());
    }
    let s = state.lock().unwrap();
    let figures_dir = s.figures_dir.clone();
    drop(s);

    let figure_name = filename
        .as_deref()
        .filter(|n| !n.is_empty())
        .map(|n| sanitize_figure_filename(n, &mime_type))
        .unwrap_or_else(|| format!("figure-{}{}", Uuid::new_v4(), image_extension(&mime_type)));
    
    let figure_path = normalize_path(&figures_dir.join(&figure_name));
    if !path_is_inside(&figures_dir, &figure_path) {
        return Err("figure path escapes global figures directory".into());
    }
    if figure_path.exists() {
        return Err("figure already exists".into());
    }
    fs::create_dir_all(&figures_dir).map_err(|e| e.to_string())?;
    let bytes = B64.decode(&content_base64).map_err(|e| e.to_string())?;
    fs::write(&figure_path, &bytes).map_err(|e| e.to_string())?;
    
    // We return the absolute path so the frontend can inject the canonical global path
    let markdown = format!("![]({})", figure_path.display());
    
    Ok(serde_json::json!({
        "ok": true,
        "path": figure_path.to_string_lossy(),
        "markdown": markdown,
    }))
}

#[tauri::command]
pub fn figures_registry(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let figures_dir = s.figures_dir.clone();
    drop(s);

    if !figures_dir.exists() {
        return Ok(serde_json::json!({ "figures": [] }));
    }

    let mut figures: Vec<FigureEntry> = vec![];
    for entry in WalkDir::new(&figures_dir)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(kind) = figure_kind(path) else {
            continue;
        };
        let created_at = fs::metadata(path)
            .map_err(|e| format!("failed to read figure metadata {}: {e}", path.display()))?
            .modified()
            .map_err(|e| {
                format!(
                    "failed to read figure modified time {}: {e}",
                    path.display()
                )
            })?
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("invalid figure modified time {}: {e}", path.display()))?
            .as_millis()
            .to_string();
        let name = path
            .file_name()
            .ok_or_else(|| format!("figure path has no file name: {}", path.display()))?
            .to_string_lossy()
            .into_owned();
        figures.push(FigureEntry {
            id: path.to_string_lossy().into_owned(),
            name,
            path: path.to_string_lossy().into_owned(),
            kind,
            created_at,
        });
    }

    figures.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| left.path.cmp(&right.path))
    });

    Ok(serde_json::json!({ "figures": figures }))
}

fn figure_kind(path: &Path) -> Option<String> {
    let ext = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))?;
    match ext.as_str() {
        ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" => Some("clipboard".into()),
        ".svg" | ".tikz" | ".xoj" | ".xopp" | ".ipe" => {
            tool_id_for_ext(&ext).map(str::to_string)
        }
        _ => None,
    }
}
