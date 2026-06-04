use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tauri::State;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::fs_utils::should_ignore;
use crate::fs_utils::{image_extension, normalize_path, path_is_inside, sanitize_figure_filename};
use crate::state::{tool_id_for_ext, AppState, FigureEntry};

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
    let figures_dir = target_doc
        .parent()
        .ok_or_else(|| format!("document path has no parent: {}", target_doc.display()))?
        .join("figures");
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
    let relative_path = format!("figures/{}", figure_name);
    let markdown = format!("![](./{relative_path})");
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
    let workspace_root = s.workspace_root();
    drop(s);

    let mut figures: Vec<FigureEntry> = vec![];
    for entry in WalkDir::new(&workspace_root)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|entry| !should_ignore(&workspace_root, entry.path()))
    {
        let entry = entry.map_err(|e| format!("failed to walk figures registry: {e}"))?;
        let path = entry.path();
        if !path.is_file() || !is_workspace_figure(&workspace_root, path)? {
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
            documents: vec![],
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

fn is_workspace_figure(workspace_root: &Path, path: &Path) -> Result<bool, String> {
    let relative = path.strip_prefix(workspace_root).map_err(|e| {
        format!(
            "walked figure path {} is outside workspace {}: {e}",
            path.display(),
            workspace_root.display()
        )
    })?;
    Ok(relative
        .components()
        .any(|component| component.as_os_str() == "figures")
        && figure_kind(path).is_some())
}

fn figure_kind(path: &Path) -> Option<String> {
    let ext = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy().to_lowercase()))?;
    match ext.as_str() {
        ".png" | ".jpg" | ".jpeg" | ".gif" | ".webp" => Some("clipboard".into()),
        ".svg" | ".tikz" | ".drawio" | ".xoj" | ".xopp" | ".ipe" => {
            tool_id_for_ext(&ext).map(str::to_string)
        }
        _ => None,
    }
}
