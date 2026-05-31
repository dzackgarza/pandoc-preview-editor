use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

use tauri::State;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::config::{get_backup_path, write_config_toml, save_session_state, figures_central_dir, register_figure, load_figures_registry};
use crate::fs_utils::{get_file_fingerprint, IGNORE_NAMES, is_markdown_file, is_text_like_file,
    normalize_path, path_is_inside, resolve_inside, should_ignore, to_client_path,
    write_file_atomic, image_extension, sanitize_figure_filename};
use crate::render::inline_preview_assets;
use crate::state::{AppState, FiguresStorageStrategy, starter_template_for_tool, tool_id_for_ext};

// ─── plugins ──────────────────────────────────────────────────────────────────


pub fn interpolate_plugin_arg(arg: &str, file_path: &Path) -> String {
    let file_str = file_path.to_string_lossy();
    let stem = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dir = file_path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    arg.replace("${FILE}", &file_str)
        .replace("${FILE_STEM}", &stem)
        .replace("${FILE_DIR}", &dir)
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

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

// ─── render ───────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct RenderResult {
    html: String,
    #[serde(rename = "durationMs")]
    duration_ms: u64,
    ok: bool,
    stderr: String,
}

#[tauri::command]
pub async fn render(
    markdown: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RenderResult, String> {
    let (command, timeout_ms, doc_path) = {
        let s = state.lock().unwrap();
        (
            s.render_command.clone(),
            s.timeout_ms,
            s.file.clone(),
            )
    };

    let started = std::time::Instant::now();

    let mut cmd = tokio::process::Command::new("zsh");
    cmd.arg("-c").arg(&command);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(ref path) = doc_path {
        cmd.env("PANDOC_DOC_PATH", path.to_string_lossy().as_ref());
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(markdown.as_bytes()).await.map_err(|e| e.to_string())?;
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| format!("renderer timed out after {}ms", timeout_ms))?
    .map_err(|e| e.to_string())?;

    let duration_ms = started.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr_text = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        let html = format!("<!-- renderer error:\n{}\n-->", &stderr_text);
        return Ok(RenderResult {
            html,
            duration_ms,
            ok: false,
            stderr: stderr_text,
        });
    }

    // Inline assets so the WebView iframe gets self-contained HTML
    let (document_dir, workspace_root) = {
        let s = state.lock().unwrap();
        (s.document_root(), s.workspace_root())
    };
    let inlined = inline_preview_assets(&stdout, &document_dir, &workspace_root);

    Ok(RenderResult {
        html: inlined,
        duration_ms,
        ok: true,
        stderr: stderr_text,
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
            s.file.clone().ok_or("no file path configured or provided")?
        }
    } else {
        s.file.clone().ok_or("no file path configured or provided")?
    };

    // Check for external modification
    if target_path.exists() {
        if let Some(registered) = s.file_fingerprints.get(&target_path.to_string_lossy().into_owned()) {
            if let Some(disk_fp) = get_file_fingerprint(&target_path) {
                if disk_fp.mtime_ms != registered.mtime_ms && disk_fp.hash != registered.hash {
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
        let _ = fs::remove_file(&old_backup);
    }
    let target_backup = get_backup_path(&target_path);
    let _ = fs::remove_file(&target_backup);

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
            s.file.clone().ok_or("No active file or path provided for backup")?
        }
    } else {
        s.file.clone().ok_or("No active file or path provided for backup")?
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

#[tauri::command]
pub fn browse(dir: String) -> Result<serde_json::Value, String> {
    let target_dir = PathBuf::from(&dir);
    let meta = fs::metadata(&target_dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err("dir must be a directory".into());
    }

    const BROWSE_IGNORE: &[&str] = IGNORE_NAMES;
    let mut entries: Vec<serde_json::Value> = fs::read_dir(&target_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || BROWSE_IGNORE.contains(&name.as_str()) {
                return None;
            }
            let abs = entry.path();
            let kind = if abs.is_dir() { "directory" } else { "file" };
            Some(serde_json::json!({
                "name": name,
                "absolutePath": abs.to_string_lossy(),
                "kind": kind,
            }))
        })
        .collect();
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

    let parent_path = target_dir.parent().map(|p| p.to_string_lossy().into_owned());
    let parent = if parent_path.as_deref() == Some(target_dir.to_string_lossy().as_ref()) {
        serde_json::Value::Null
    } else {
        parent_path.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
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

    let mut entries: Vec<serde_json::Value> = fs::read_dir(&target_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let abs = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let client_path = to_client_path(&workspace_root, &abs);
            if should_ignore(&workspace_root, &abs) {
                return None;
            }
            if abs.is_dir() {
                return Some(serde_json::json!({
                    "name": name,
                    "path": client_path,
                    "kind": "directory",
                }));
            }
            if abs.is_file() && is_text_like_file(&abs) {
                return Some(serde_json::json!({
                    "name": name,
                    "path": client_path,
                    "kind": "file",
                }));
            }
            None
        })
        .collect();
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

fn collect_markdown_files(workspace_root: &Path, dir: &Path) -> Vec<serde_json::Value> {
    let mut results = vec![];
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return results,
    };
    let mut children: Vec<_> = entries.flatten().collect();
    children.sort_by_key(|e| e.file_name());
    for entry in children {
        let abs = entry.path();
        if should_ignore(workspace_root, &abs) {
            continue;
        }
        if abs.is_dir() {
            results.extend(collect_markdown_files(workspace_root, &abs));
        } else if abs.is_file() && is_markdown_file(&abs) {
            let path = to_client_path(workspace_root, &abs);
            let name = abs
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let dir_part = {
                let d = path.rsplit('/').skip(1).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/");
                d
            };
            results.push(serde_json::json!({
                "path": path,
                "absolutePath": abs.to_string_lossy(),
                "name": name,
                "dir": dir_part,
                "recent": false,
            }));
        }
    }
    results
}

#[tauri::command]
pub fn quick_open(
    q: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let query = q.unwrap_or_default().trim().to_lowercase();

    let workspace_entries = collect_markdown_files(&workspace_root, &workspace_root);

    let recent_entries: Vec<serde_json::Value> = s
        .recent_files
        .iter()
        .filter(|p| {
            path_is_inside(&workspace_root, p)
                && p.exists()
                && p.is_file()
                && is_markdown_file(p)
                && !should_ignore(&workspace_root, p)
        })
        .map(|p| {
            let path = to_client_path(&workspace_root, p);
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let dir_part = path.rsplit('/').skip(1).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/");
            serde_json::json!({
                "path": path,
                "absolutePath": p.to_string_lossy(),
                "name": name,
                "dir": dir_part,
                "recent": true,
            })
        })
        .collect();

    let recent_paths: std::collections::HashSet<String> = recent_entries
        .iter()
        .filter_map(|e| e["path"].as_str().map(String::from))
        .collect();

    let matches = |entry: &serde_json::Value| -> bool {
        if query.is_empty() {
            return true;
        }
        let name = entry["name"].as_str().unwrap_or("").to_lowercase();
        let path = entry["path"].as_str().unwrap_or("").to_lowercase();
        name.contains(&query) || path.contains(&query)
    };

    let mut entries: Vec<serde_json::Value> = recent_entries
        .into_iter()
        .filter(|e| matches(e))
        .collect();
    entries.extend(
        workspace_entries
            .into_iter()
            .filter(|e| {
                !recent_paths.contains(e["path"].as_str().unwrap_or("")) && matches(e)
            }),
    );

    Ok(serde_json::json!({
        "root": workspace_root.to_string_lossy(),
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
    s.workspace_root = Some(
        target_path
            .parent()
            .unwrap_or(&target_path)
            .to_path_buf(),
    );
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

fn track_recent(recent: &mut Vec<PathBuf>, path: &Path) {
    recent.retain(|p| p != path);
    recent.insert(0, path.to_path_buf());
    recent.truncate(10);
}

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
                    (name.ends_with(".html") || name.ends_with(".template"))
                        && e.path().is_file()
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

// ─── config ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_config(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    let parsed = serde_json::to_value(&s.parsed_flags).unwrap_or(serde_json::Value::Null);
    serde_json::json!({
        "templatesDir": s.templates_dir.to_string_lossy(),
        "filtersDir": s.filters_dir.to_string_lossy(),
        "debounceMs": s.debounce_ms,
        "timeoutMs": s.timeout_ms,
        "renderCommand": s.render_command,
        "restoreLastFile": s.restore_last_file,
        "parsedFlags": parsed,
    })
}

#[tauri::command]
pub fn set_config(
    templates_dir: String,
    filters_dir: String,
    debounce_ms: u64,
    timeout_ms: u64,
    render_command: String,
    restore_last_file: Option<bool>,
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
    s.parsed_flags = crate::command_flags::parse_render_command(&render_command);
    s.restore_last_file = restore_last_file.unwrap_or(true);

    if let Some(ref config_path) = s.config_path {
        write_config_toml(
            config_path,
            debounce_ms,
            timeout_ms,
            restore_last_file.unwrap_or(true),
            &render_command,
            &templates_dir,
            &filters_dir,
        )?;
    }

    Ok(serde_json::json!({ "ok": true }))
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
                dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp")).join(&f.path[2..])
            } else {
                PathBuf::from(&f.path)
            };
            if p.is_absolute() { p } else { std::env::current_dir().unwrap_or_default().join(p) }
        })
        .collect();

    let mut files: Vec<serde_json::Value> = vec![];
    if filters_dir.exists() {
        if let Ok(entries) = fs::read_dir(&filters_dir) {
            files = entries
                .flatten()
                .filter(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .ends_with(".lua")
                        && e.path().is_file()
                })
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
    let mut new_filters: Vec<crate::command_flags::FilterEntry> = s
        .parsed_flags
        .filters
        .iter()
        .filter(|f| {
            let p = if f.path.starts_with("~/") {
                dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp")).join(&f.path[2..])
            } else {
                PathBuf::from(&f.path)
            };
            let resolved = if p.is_absolute() { p } else { std::env::current_dir().unwrap_or_default().join(p) };
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
        new_filters.push(crate::command_flags::FilterEntry {
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

// ─── zotero ───────────────────────────────────────────────────────────────────

const ZOTERO_CAYW_URL: &str = "http://127.0.0.1:23119/better-bibtex/cayw";

#[tauri::command]
pub async fn zotero_cite() -> Result<serde_json::Value, String> {
    let url = format!("{}?format=pandoc&brackets=1", ZOTERO_CAYW_URL);
    let response = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("zotero returned {}", response.status()));
    }
    let citation = response.text().await.map_err(|e| e.to_string())?.trim().to_string();
    if citation.is_empty() {
        return Ok(serde_json::json!({ "empty": true }));
    }
    Ok(serde_json::json!({ "citation": citation }))
}

// ─── diagram proxy ────────────────────────────────────────────────────────────

const ALLOWED_PROXY_HOSTS: &[&str] = &["q.uiver.app", "freetikz.app", "homepages.inf.ed.ac.uk"];

#[tauri::command]
pub async fn diagram_proxy(url: String) -> Result<serde_json::Value, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL format".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    if !ALLOWED_PROXY_HOSTS.contains(&host) || parsed.scheme() != "https" {
        return Err("proxy host not allowed".into());
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("proxy failed with status {}", response.status()));
    }

    let mut html = response.text().await.map_err(|e| e.to_string())?;
    let base_tag = format!("<base href=\"{}\">", url);
    if html.contains("<head>") {
        html = html.replacen("<head>", &format!("<head>{}", base_tag), 1);
    } else {
        html = format!("{}{}", base_tag, html);
    }

    // Premium TikZ overlay injected into proxied diagram tool pages
    let overlay = include_str!("../assets/tikz-overlay.html");
    if html.contains("</body>") {
        html = html.replacen("</body>", &format!("{}</body>", overlay), 1);
    } else {
        html.push_str(overlay);
    }

    Ok(serde_json::json!({ "html": html }))
}

// ─── diagram tools ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_diagram_tools(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    serde_json::Value::Object(
        s.tool_state
            .iter()
            .map(|(id, entry)| (id.clone(), serde_json::Value::Bool(entry.installed)))
            .collect(),
    )
}

#[tauri::command]
pub fn create_diagram_file(
    kind: String,
    filename: String,
    document_path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let resolved_doc = if Path::new(&document_path).is_absolute() {
        PathBuf::from(&document_path)
    } else {
        resolve_inside(&workspace_root, &document_path)?
    };
    if s.is_temp_file || s.file.is_none() || s.file.as_ref() != Some(&resolved_doc) {
        return Err("save the document before adding figures".into());
    }
    let is_central = matches!(s.figures_storage_strategy, FiguresStorageStrategy::Central);
    let figures_dir = if is_central {
        figures_central_dir(&s)
    } else {
        s.file
            .as_ref()
            .and_then(|f| f.parent())
            .unwrap_or(Path::new("."))
            .join("figures")
    };
    let figure_path = normalize_path(&figures_dir.join(&filename));
    if !path_is_inside(&figures_dir, &figure_path) {
        return Err("figure path escapes figures directory".into());
    }
    if figure_path.exists() {
        return Err("figure already exists".into());
    }
    fs::create_dir_all(&figures_dir).map_err(|e| e.to_string())?;
    let template = starter_template_for_tool(&kind);
    fs::write(&figure_path, template).map_err(|e| e.to_string())?;

    if is_central {
        register_figure(&s, &filename, &figure_path, &kind);
    }

    let relative_path = if is_central {
        figure_path.to_string_lossy().into_owned()
    } else {
        format!("figures/{}", filename)
    };
    Ok(serde_json::json!({
        "ok": true,
        "absolutePath": figure_path.to_string_lossy(),
        "relativePath": relative_path,
    }))
}

#[tauri::command]
pub fn launch_diagram(
    absolute_path: String,
    kind: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let tool_type = kind.unwrap_or_else(|| {
        let ext = Path::new(&absolute_path)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        tool_id_for_ext(&ext).to_string()
    });
    let entry = s
        .tool_state
        .get(&tool_type)
        .ok_or_else(|| format!("unknown tool: {}", tool_type))?;
    if !entry.installed {
        return Err(format!(
            "Desktop application for {} is not installed on this system",
            tool_type
        ));
    }
    let resolved = if Path::new(&absolute_path).is_absolute() {
        PathBuf::from(&absolute_path)
    } else if let Some(ref file) = s.file {
        file.parent()
            .unwrap_or(Path::new("."))
            .join(&absolute_path)
    } else {
        PathBuf::from(&absolute_path)
    };
    let cmd = entry.cmd.clone();
    drop(s);
    std::process::Command::new(&cmd)
        .arg(&resolved)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

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
        resolve_inside(&workspace_root, &document_path)?
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
        .unwrap_or_else(|| {
            format!("figure-{}{}", Uuid::new_v4(), image_extension(&mime_type))
        });
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

// ─── plugins ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_plugins(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    let metadata: Vec<serde_json::Value> = s
        .plugins
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "category": p.category,
            })
        })
        .collect();
    serde_json::json!({ "plugins": metadata })
}

#[tauri::command]
pub async fn run_plugin(
    id: String,
    markdown: String,
    path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let (plugin, file_path, timeout_ms) = {
        let mut s = state.lock().unwrap();
        let plugin = s
            .plugins
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or("plugin not found")?;

        let target_path: PathBuf = if let Some(ref p) = path {
            PathBuf::from(p)
        } else if let Some(ref f) = s.file {
            if s.is_temp_file {
                return Err("no file path: save the document first".into());
            }
            f.clone()
        } else {
            return Err("no file path: save the document first".into());
        };

        fs::write(&target_path, &markdown).map_err(|e| e.to_string())?;
        track_recent(&mut s.recent_files, &target_path);
        (plugin, target_path, s.timeout_ms)
    };

    let args: Vec<String> = plugin
        .args
        .iter()
        .map(|a| interpolate_plugin_arg(a, &file_path))
        .collect();
    let output_path = plugin
        .output
        .as_deref()
        .map(|o| interpolate_plugin_arg(o, &file_path));
    let plugin_timeout = plugin.timeout_ms.unwrap_or(timeout_ms);
    let cwd = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();

    let output = tokio::time::timeout(
        std::time::Duration::from_millis(plugin_timeout),
        tokio::process::Command::new(&plugin.command)
            .args(&args)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| format!("plugin timed out after {}ms", plugin_timeout))?
    .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let exit_code = output.status.code();
    let ok = output.status.success();

    Ok(serde_json::json!({
        "ok": ok,
        "stdout": stdout,
        "stderr": stderr,
        "exitCode": exit_code,
        "outputPath": output_path,
    }))
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
        let has_rofi = Path::new("/usr/bin/rofi").exists() || Path::new("/bin/rofi").exists();
        let has_dmenu = Path::new("/usr/bin/dmenu").exists() || Path::new("/bin/dmenu").exists();
        let has_fd = Path::new("/usr/bin/fd").exists() || Path::new("/bin/fd").exists();
        let finder = if has_fd { "fd -e md -t f" } else { "find . -name '*.md'" };
        if has_rofi {
            format!("{} | rofi -dmenu -i -p \"Quick Open:\"", finder)
        } else if has_dmenu {
            format!("{} | dmenu -i -p \"Quick Open:\"", finder)
        } else {
            format!("{} | dmenu -i -p \"Quick Open:\"", finder)
        }
    };

    let output = tokio::process::Command::new("zsh")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&workspace_root)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    // Exit code 130 = user dismissed; 1 = nothing selected
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
            s.file_fingerprints.insert(target_path.to_string_lossy().into_owned(), fp);
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


pub fn register_commands(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![
        get_initial_state,
        render,
        save,
        backup,
        browse,
        list_files,
        quick_open,
        quick_open_spawn,
        file_content,
        file_exists,
        new_file,
        open_file_external,
        pandoc_assets,
        get_config,
        set_config,
        list_filters,
        toggle_filters,
        zotero_cite,
        diagram_proxy,
        get_diagram_tools,
        create_diagram_file,
        launch_diagram,
        save_figure_asset,
        figures_registry,
        list_plugins,
        run_plugin,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolate_plugin_arg_substitutes_file() {
        let result = interpolate_plugin_arg("${FILE}", Path::new("/ws/doc.md"));
        assert_eq!(result, "/ws/doc.md");
    }

    #[test]
    fn interpolate_plugin_arg_substitutes_stem() {
        let result = interpolate_plugin_arg("${FILE_STEM}", Path::new("/ws/doc.md"));
        assert_eq!(result, "doc");
    }

    #[test]
    fn interpolate_plugin_arg_substitutes_dir() {
        let result = interpolate_plugin_arg("${FILE_DIR}", Path::new("/ws/doc.md"));
        assert_eq!(result, "/ws");
    }
}
