use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::State;
use uuid::Uuid;

use crate::config::{get_backup_path, save_session_state};
use crate::fs_utils::{
    get_file_fingerprint, is_markdown_file, is_text_like_file, path_is_inside, resolve_inside,
    should_ignore, to_client_path, write_file_atomic,
};
use crate::state::AppState;

pub(crate) fn track_recent(recent: &mut Vec<PathBuf>, path: &Path) {
    recent.retain(|p| p != path);
    recent.insert(0, path.to_path_buf());
    recent.truncate(10);
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_initial_state(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    let has_backup = if let Some(ref file) = s.file {
        s.recovered_from_backup || get_backup_path(file).exists()
    } else {
        false
    };
    serde_json::json!({
        "content": s.current_file_content(),
        "file": s.file.as_ref().filter(|_| !s.is_temp_file).map(|p| p.to_string_lossy()),
        "tempBackupFile": if s.is_temp_file { s.file.as_ref().map(|p| p.to_string_lossy().into_owned()) } else { None },
        "workspaceRoot": s.workspace_root().to_string_lossy(),
        "isTempFile": s.is_temp_file,
        "recoveredFromBackup": has_backup,
    })
}

// ─── save ─────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct SaveResult {
    ok: bool,
    path: String,
    #[serde(rename = "workspaceRoot")]
    workspace_root: String,
}

#[tauri::command]
pub fn save(
    markdown: String,
    path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<SaveResult, String> {
    let mut s = state.lock().unwrap();
    let workspace_root = s.workspace_root();

    let target_path: PathBuf = if let Some(ref p) = path {
        if !p.is_empty() {
            if Path::new(p).is_absolute() {
                PathBuf::from(p)
            } else {
                resolve_inside(&workspace_root, p)?
            }
        } else {
            s.file
                .clone()
                .ok_or("no file path configured or provided")?
        }
    } else {
        s.file
            .clone()
            .ok_or("no file path configured or provided")?
    };

    // Check for external modification
    if target_path.exists() {
        if let Some(registered) = s
            .file_fingerprints
            .get(&target_path.to_string_lossy().into_owned())
        {
            if let Some(disk_fp) = get_file_fingerprint(&target_path) {
                if disk_fp.hash != registered.hash {
                    return Err("The file has been modified externally.".into());
                }
            }
        }
    }

    let old_path = s.file.clone();
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_file_atomic(&target_path, &markdown)?;

    // Update fingerprint
    if let Some(fp) = get_file_fingerprint(&target_path) {
        s.file_fingerprints
            .insert(target_path.to_string_lossy().into_owned(), fp);
    }

    // Track recent
    track_recent(&mut s.recent_files, &target_path);

    // Update config file / workspace root
    if let Some(ref p) = path {
        if !p.is_empty() && Some(&target_path) != s.file.as_ref() {
            let new_ws = if path_is_inside(&workspace_root, &target_path) {
                workspace_root.clone()
            } else {
                target_path.parent().unwrap_or(&target_path).to_path_buf()
            };
            s.file = Some(target_path.clone());
            s.is_temp_file = false;
            s.workspace_root = Some(new_ws);
        }
    } else if s.file.as_ref() == Some(&target_path) {
        s.is_temp_file = false;
    }

    // Clean up old backup
    if let Some(ref old) = old_path {
        let old_backup = get_backup_path(old);
        remove_file_if_present(&old_backup)?;
    }
    let target_backup = get_backup_path(&target_path);
    remove_file_if_present(&target_backup)?;

    save_session_state(&target_path, s.is_temp_file);

    Ok(SaveResult {
        ok: true,
        path: target_path.to_string_lossy().into_owned(),
        workspace_root: s.workspace_root().to_string_lossy().into_owned(),
    })
}

// ─── backup ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn backup(
    markdown: String,
    path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();

    let doc_path: PathBuf = if let Some(ref p) = path {
        if !p.is_empty() {
            if Path::new(p).is_absolute() {
                PathBuf::from(p)
            } else {
                resolve_inside(&workspace_root, p)?
            }
        } else {
            s.file
                .clone()
                .ok_or("No active file or path provided for backup")?
        }
    } else {
        s.file
            .clone()
            .ok_or("No active file or path provided for backup")?
    };

    let backup_path = get_backup_path(&doc_path);
    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&backup_path, &markdown).map_err(|e| e.to_string())?;

    if Some(&doc_path) == s.file.as_ref() && s.is_temp_file {
        fs::write(&doc_path, &markdown).map_err(|e| e.to_string())?;
    }

    let is_temp = if Some(&doc_path) == s.file.as_ref() {
        s.is_temp_file
    } else {
        false
    };
    save_session_state(&doc_path, is_temp);

    Ok(serde_json::json!({
        "ok": true,
        "backupPath": backup_path.to_string_lossy(),
    }))
}

// ─── files ────────────────────────────────────────────────────────────────────

use crate::fs_utils::IGNORE_NAMES;

#[tauri::command]
pub fn browse(dir: String) -> Result<serde_json::Value, String> {
    let target_dir = PathBuf::from(&dir);
    let meta = fs::metadata(&target_dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err("dir must be a directory".into());
    }

    const BROWSE_IGNORE: &[&str] = IGNORE_NAMES;
    let mut entries: Vec<serde_json::Value> = vec![];
    for entry in fs::read_dir(&target_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || BROWSE_IGNORE.contains(&name.as_str()) {
            continue;
        }
        let abs = entry.path();
        let kind = if abs.is_dir() { "directory" } else { "file" };
        entries.push(serde_json::json!({
            "name": name,
            "absolutePath": abs.to_string_lossy(),
            "kind": kind,
        }));
    }
    entries.sort_by(|a, b| {
        let ka = a["kind"].as_str().unwrap_or("");
        let kb = b["kind"].as_str().unwrap_or("");
        let na = a["name"].as_str().unwrap_or("");
        let nb = b["name"].as_str().unwrap_or("");
        if ka != kb {
            return if ka == "directory" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        na.cmp(nb)
    });

    let parent_path = target_dir
        .parent()
        .map(|p| p.to_string_lossy().into_owned());
    let parent = if parent_path.as_deref() == Some(target_dir.to_string_lossy().as_ref()) {
        serde_json::Value::Null
    } else {
        parent_path
            .map(serde_json::Value::String)
            .unwrap_or(serde_json::Value::Null)
    };

    Ok(serde_json::json!({
        "dir": target_dir.to_string_lossy(),
        "parent": parent,
        "entries": entries,
    }))
}

#[tauri::command]
pub fn list_files(
    dir: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target_dir = resolve_inside(&workspace_root, dir.as_deref().unwrap_or(""))?;
    let meta = fs::metadata(&target_dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err("dir must reference a directory".into());
    }

    let mut entries: Vec<serde_json::Value> = vec![];
    for entry in fs::read_dir(&target_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let abs = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let client_path = to_client_path(&workspace_root, &abs);
        if should_ignore(&workspace_root, &abs) {
            continue;
        }
        if abs.is_dir() {
            entries.push(serde_json::json!({
                "name": name,
                "path": client_path,
                "kind": "directory",
            }));
            continue;
        }
        if abs.is_file() && is_text_like_file(&abs) {
            entries.push(serde_json::json!({
                "name": name,
                "path": client_path,
                "kind": "file",
            }));
        }
    }
    entries.sort_by(|a, b| {
        let ka = a["kind"].as_str().unwrap_or("");
        let kb = b["kind"].as_str().unwrap_or("");
        let na = a["name"].as_str().unwrap_or("");
        let nb = b["name"].as_str().unwrap_or("");
        if ka != kb {
            return if ka == "directory" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        na.cmp(nb)
    });

    Ok(serde_json::json!({
        "root": workspace_root.to_string_lossy(),
        "dir": to_client_path(&workspace_root, &target_dir),
        "entries": entries,
    }))
}

#[tauri::command]
pub fn file_content(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target_path = resolve_inside(&workspace_root, &path)?;
    let meta = fs::metadata(&target_path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("path must reference a file".into());
    }
    if !is_text_like_file(&target_path) {
        return Err("file does not look like text".into());
    }
    let content = fs::read_to_string(&target_path).map_err(|e| e.to_string())?;

    if let Some(fp) = get_file_fingerprint(&target_path) {
        s.file_fingerprints
            .insert(target_path.to_string_lossy().into_owned(), fp);
    }
    track_recent(&mut s.recent_files, &target_path);
    s.file = Some(target_path.clone());
    s.is_temp_file = false;
    save_session_state(&target_path, false);

    let client_path = to_client_path(&workspace_root, &target_path);
    Ok(serde_json::json!({
        "path": client_path,
        "absolutePath": target_path.to_string_lossy(),
        "content": content,
    }))
}

#[tauri::command]
pub fn file_exists(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        resolve_inside(&workspace_root, &path)?
    };
    Ok(serde_json::json!({ "exists": target.exists() }))
}

#[tauri::command]
pub fn new_file(
    path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target_path = if let Some(ref p) = path {
        if !p.is_empty() {
            if Path::new(p).is_absolute() {
                PathBuf::from(p)
            } else {
                resolve_inside(&workspace_root, p)?
            }
        } else {
            resolve_inside(&workspace_root, &format!("untitled-{}.md", Uuid::new_v4()))?
        }
    } else {
        resolve_inside(&workspace_root, &format!("untitled-{}.md", Uuid::new_v4()))?
    };

    if target_path.exists() {
        return Err("file already exists".into());
    }
    track_recent(&mut s.recent_files, &target_path);
    s.file = Some(target_path.clone());
    s.file_content = Some(String::new());
    s.is_temp_file = false;
    s.workspace_root = Some(target_path.parent().unwrap_or(&target_path).to_path_buf());
    save_session_state(&target_path, false);

    Ok(serde_json::json!({
        "ok": true,
        "path": target_path.to_string_lossy(),
        "absolutePath": target_path.to_string_lossy(),
        "content": "",
        "workspaceRoot": s.workspace_root().to_string_lossy(),
    }))
}

#[tauri::command]
pub fn open_file_external(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        resolve_inside(&workspace_root, &path)?
    };
    drop(s);
    std::process::Command::new("xdg-open")
        .arg(&target)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

// ─── quick-open-spawn (rofi/dmenu) ───────────────────────────────────────────

#[tauri::command]
pub async fn quick_open_spawn(
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let (workspace_root, launcher_cmd) = {
        let s = state.lock().unwrap();
        (s.workspace_root(), s.launcher_command.clone())
    };

    let cmd = if let Some(c) = launcher_cmd {
        c
    } else {
        let has_rofi = which::which("rofi").is_ok();
        let has_dmenu = which::which("dmenu").is_ok();
        let has_fd = which::which("fd").is_ok();
        let finder = if has_fd {
            "fd -e md -t f"
        } else {
            "find . -name '*.md'"
        };
        if has_rofi {
            format!("{} | rofi -dmenu -i -p \"Quick Open:\"", finder)
        } else if has_dmenu {
            format!("{} | dmenu -i -p \"Quick Open:\"", finder)
        } else {
            return Err("quick open requires either rofi or dmenu to be installed".into());
        }
    };

    let output = tokio::process::Command::new("zsh")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&workspace_root)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let code = output.status.code().unwrap_or(0);
    if code == 130 || code == 1 {
        return Ok(serde_json::json!({ "ok": false, "cancelled": true }));
    }

    let trimmed = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if trimmed.is_empty() {
        return Ok(serde_json::json!({ "ok": false, "cancelled": true }));
    }

    let target_path = resolve_inside(&workspace_root, &trimmed)?;
    if !target_path.exists() || !target_path.is_file() {
        return Ok(serde_json::json!({
            "ok": false,
            "error": format!("Selected path \"{}\" does not exist or is not a file.", trimmed),
        }));
    }
    if !is_markdown_file(&target_path) {
        return Ok(serde_json::json!({
            "ok": false,
            "error": format!("Selected path \"{}\" is not a markdown file.", trimmed),
        }));
    }

    let content = fs::read_to_string(&target_path).map_err(|e| e.to_string())?;
    let relative_path = to_client_path(&workspace_root, &target_path);

    {
        let mut s = state.lock().unwrap();
        if let Some(fp) = get_file_fingerprint(&target_path) {
            s.file_fingerprints
                .insert(target_path.to_string_lossy().into_owned(), fp);
        }
        track_recent(&mut s.recent_files, &target_path);
        s.file = Some(target_path.clone());
        s.is_temp_file = false;
        save_session_state(&target_path, false);
    }

    Ok(serde_json::json!({
        "ok": true,
        "path": relative_path,
        "absolutePath": target_path.to_string_lossy(),
        "content": content,
    }))
}
