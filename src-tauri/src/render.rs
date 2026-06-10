use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;

use tauri::State;
use tokio::io::AsyncWriteExt;

use crate::state::AppState;

// ─── Tauri render command ─────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct RenderSuccess {
    pub html: String,
    pub stderr: String,
}

#[derive(serde::Serialize)]
pub struct RenderError {
    pub message: String,
    pub stderr: String,
}

/// Core render logic — testable without Tauri State.
pub async fn execute_render(
    markdown: &str,
    command: &str,
    timeout_ms: u64,
    doc_path: Option<&Path>,
) -> Result<RenderSuccess, RenderError> {
    let timeout = std::time::Duration::from_millis(timeout_ms);

    let mut cmd = tokio::process::Command::new("zsh");
    cmd.arg("-c").arg(command);
    cmd.kill_on_drop(true);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = doc_path {
        cmd.env("PANDOC_DOC_PATH", path.to_string_lossy().as_ref());
    }

    let mut child = cmd.spawn().map_err(|e| RenderError {
        message: format!("Failed to spawn renderer: {}", e),
        stderr: String::new(),
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(markdown.as_bytes())
            .await
            .map_err(|e| RenderError {
                message: format!("Failed to write to renderer stdin: {}", e),
                stderr: String::new(),
            })?;
    }

    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| RenderError {
            message: format!("renderer timed out after {}ms", timeout_ms),
            stderr: String::new(),
        })?
        .map_err(|e| RenderError {
            message: format!("Failed to wait for renderer: {}", e),
            stderr: String::new(),
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr_text = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        return Err(RenderError {
            message: format!("Renderer exited with {}", output.status),
            stderr: stderr_text,
        });
    }

    Ok(RenderSuccess {
        html: stdout,
        stderr: stderr_text,
    })
}

#[tauri::command]
pub async fn render(
    markdown: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RenderSuccess, RenderError> {
    let (command, timeout_ms, doc_path) = {
        let s = state.lock().unwrap();
        (s.render_command.clone(), s.timeout_ms, s.file.clone())
    };
    let doc_path_ref = doc_path.as_deref();
    execute_render(&markdown, &command, timeout_ms, doc_path_ref).await
}
