use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::State;

use crate::fs_utils::{normalize_path, path_is_inside};
use crate::state::{starter_template_for_tool, tool_id_for_ext, AppState};

// ─── diagram proxy ────────────────────────────────────────────────────────────

const ALLOWED_PROXY_HOSTS: &[&str] = &["q.uiver.app", "freetikz.app", "homepages.inf.ed.ac.uk"];

#[tauri::command]
pub async fn diagram_proxy(url: String) -> Result<serde_json::Value, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL format".to_string())?;
    
    if parsed.scheme() != "https" {
        return Err("proxy requires https scheme".into());
    }

    let host = parsed.host_str().ok_or_else(|| "missing host in URL".to_string())?;
    
    if !ALLOWED_PROXY_HOSTS.contains(&host) {
        return Err(format!("proxy host not allowed: {}", host));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
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

    // Export overlay injected into proxied diagram tool pages
    let overlay = include_str!("../../assets/tikz-overlay.html");
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
    let installed_ids = s.tool_state.keys().collect::<Vec<_>>();

    serde_json::Value::Object(
        crate::state::all_diagram_tool_ids()
            .into_iter()
            .map(|id| {
                let is_installed = installed_ids.contains(&&id);
                (id, serde_json::Value::Bool(is_installed))
            })
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
    let workspace_root = s.workspace_root()?;
    let resolved_doc = if Path::new(&document_path).is_absolute() {
        PathBuf::from(&document_path)
    } else {
        crate::fs_utils::resolve_inside(&workspace_root, &document_path)?
    };
    if s.is_temp_file || s.file.is_none() || s.file.as_ref() != Some(&resolved_doc) {
        return Err("save the document before adding figures".into());
    }
    let figures_dir = resolved_doc
        .parent()
        .ok_or_else(|| format!("document path has no parent: {}", resolved_doc.display()))?
        .join("figures");
    let figure_path = normalize_path(&figures_dir.join(&filename));
    if !path_is_inside(&figures_dir, &figure_path) {
        return Err("figure path escapes figures directory".into());
    }
    if figure_path.exists() {
        return Err("figure already exists".into());
    }
    fs::create_dir_all(&figures_dir).map_err(|e| e.to_string())?;
    let template = starter_template_for_tool(&kind)?;
    fs::write(&figure_path, template).map_err(|e| e.to_string())?;
    let relative_path = format!("figures/{}", filename);
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
    let tool_type = match kind {
        Some(kind) => kind,
        None => {
            let ext = Path::new(&absolute_path)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                .ok_or_else(|| format!("diagram path has no extension: {absolute_path}"))?;
            tool_id_for_ext(&ext)
                .ok_or_else(|| format!("unknown diagram extension: {ext}"))?
                .to_string()
        }
    };
    let entry = s
        .tool_state
        .get(&tool_type)
        .ok_or_else(|| format!("Desktop application for {} is not installed on this system", tool_type))?;
    let resolved = if Path::new(&absolute_path).is_absolute() {
        PathBuf::from(&absolute_path)
    } else if let Some(ref file) = s.file {
        file.parent()
            .ok_or_else(|| format!("active file has no parent directory: {}", file.display()))?
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
