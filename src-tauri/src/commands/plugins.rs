use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use tauri::State;

use crate::commands::document::track_recent;
use crate::state::AppState;

// ─── helpers ──────────────────────────────────────────────────────────────────

fn interpolate_plugin_arg(arg: &str, file_path: &Path) -> Result<String, String> {
    let file_str = file_path.to_string_lossy();
    let stem = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .ok_or_else(|| format!("plugin target has no file stem: {}", file_path.display()))?;
    let dir = file_path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| {
            format!(
                "plugin target has no parent directory: {}",
                file_path.display()
            )
        })?;
    Ok(arg
        .replace("${FILE}", &file_str)
        .replace("${FILE_STEM}", &stem)
        .replace("${FILE_DIR}", &dir))
}

// ─── plugins ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_plugins(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    println!(
        "[Rust] list_plugins called. Count: {}, Plugins: {:?}",
        s.plugins.len(),
        s.plugins.iter().map(|p| &p.name).collect::<Vec<_>>()
    );
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
        .collect::<Result<Vec<_>, _>>()?;
    let output_path = plugin
        .output
        .as_deref()
        .map(|o| interpolate_plugin_arg(o, &file_path))
        .transpose()?;
    let plugin_timeout = plugin.timeout_ms.unwrap_or(timeout_ms);
    let cwd = file_path
        .parent()
        .ok_or_else(|| {
            format!(
                "plugin target has no parent directory: {}",
                file_path.display()
            )
        })?
        .to_path_buf();
    let timeout = std::time::Duration::from_millis(plugin_timeout);
    let mut command = tokio::process::Command::new(&plugin.command);
    command.kill_on_drop(true);
    command
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = tokio::time::timeout(timeout, command.output())
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
