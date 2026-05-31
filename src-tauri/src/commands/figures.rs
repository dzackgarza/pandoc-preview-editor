use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tauri::State;
use uuid::Uuid;

use crate::config::{figures_central_dir, load_figures_registry, register_figure};
use crate::fs_utils::{image_extension, normalize_path, path_is_inside, sanitize_figure_filename};
use crate::state::{AppState, FiguresStorageStrategy};

// ─── figures assets ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_figure_asset(
    content_base64: String,
    document_path: String,
    filename: Option<String>,
    mime_type: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    if !mime_type.starts_with("image/") {
        return Err("mimeType must be an image type".into());
    }
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target_doc = if Path::new(&document_path).is_absolute() {
        PathBuf::from(&document_path)
    } else {
        crate::fs_utils::resolve_inside(&workspace_root, &document_path)?
    };
    if s.file.is_none() || s.is_temp_file || s.file.as_ref() != Some(&target_doc) {
        return Err("save the document before adding figures".into());
    }
    let is_central = matches!(s.figures_storage_strategy, FiguresStorageStrategy::Central);
    let figures_dir = if is_central {
        figures_central_dir(&s)
    } else {
        target_doc
            .parent()
            .unwrap_or(Path::new("."))
            .join("figures")
    };
    let figure_name = filename
        .as_deref()
        .filter(|n| !n.is_empty())
        .map(|n| sanitize_figure_filename(n, &mime_type))
        .unwrap_or_else(|| format!("figure-{}{}", Uuid::new_v4(), image_extension(&mime_type)));
    let figure_path = normalize_path(&figures_dir.join(&figure_name));
    if !path_is_inside(&figures_dir, &figure_path) {
        return Err("figure path escapes figures directory".into());
    }
    if figure_path.exists() {
        return Err("figure already exists".into());
    }
    fs::create_dir_all(&figures_dir).map_err(|e| e.to_string())?;
    let bytes = B64.decode(&content_base64).map_err(|e| e.to_string())?;
    fs::write(&figure_path, &bytes).map_err(|e| e.to_string())?;

    if is_central {
        register_figure(&s, &figure_name, &figure_path, "clipboard");
    }

    let relative_path = if is_central {
        figure_path.to_string_lossy().into_owned()
    } else {
        format!("figures/{}", figure_name)
    };
    let markdown = if is_central {
        format!("![]({})", relative_path)
    } else {
        format!("![](./{relative_path})")
    };
    Ok(serde_json::json!({
        "ok": true,
        "path": figure_path.to_string_lossy(),
        "relativePath": relative_path,
        "markdown": markdown,
    }))
}

#[tauri::command]
pub fn figures_registry(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let central_dir = figures_central_dir(&s);
    let registry = load_figures_registry(&central_dir);
    Ok(serde_json::to_value(registry).unwrap())
}
