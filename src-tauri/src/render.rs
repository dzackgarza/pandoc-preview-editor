use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;

use tauri::State;
use tokio::io::AsyncWriteExt;

use crate::state::AppState;

// ─── Tauri render command ─────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct RenderResult {
    pub html: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub ok: bool,
    pub stderr: String,
}

/// Core render logic — testable without Tauri State.
pub async fn execute_render(
    markdown: &str,
    command: &str,
    timeout_ms: u64,
    doc_path: Option<&Path>,
) -> Result<RenderResult, String> {
    let started = std::time::Instant::now();

    let mut cmd = tokio::process::Command::new("zsh");
    cmd.arg("-c").arg(command);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = doc_path {
        cmd.env("PANDOC_DOC_PATH", path.to_string_lossy().as_ref());
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(markdown.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
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

    Ok(RenderResult {
        html: stdout,
        duration_ms,
        ok: true,
        stderr: stderr_text,
    })
}

#[tauri::command]
pub async fn render(
    markdown: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RenderResult, String> {
    let (command, timeout_ms, doc_path) = {
        let s = state.lock().unwrap();
        (s.render_command.clone(), s.timeout_ms, s.file.clone())
    };
    let doc_path_ref = doc_path.as_deref();
    execute_render(&markdown, &command, timeout_ms, doc_path_ref).await
}

