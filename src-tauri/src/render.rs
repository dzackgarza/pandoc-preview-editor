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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn render_basic_markdown_produces_html() {
        let result = execute_render(
            "# Hello\n\nWorld",
            "pandoc --standalone -t html5",
            30_000,
            None,
        )
        .await
        .expect("render should succeed");
        assert!(
            result.ok,
            "render.ok should be true, stderr: {}",
            result.stderr
        );
        assert!(result.html.contains("<h1"), "output should contain h1 tag");
        assert!(
            result.html.contains("Hello"),
            "output should contain heading text"
        );
        assert!(
            result.html.contains("World"),
            "output should contain paragraph text"
        );
        assert!(result.duration_ms > 0, "duration should be positive");
    }

    #[tokio::test]
    async fn render_empty_input_produces_output() {
        let result = execute_render("", "pandoc --standalone -t html5", 30_000, None)
            .await
            .expect("render should succeed");
        assert!(result.ok, "empty input should succeed");
    }

    #[tokio::test]
    async fn render_invalid_command_returns_error() {
        let result = execute_render(
            "# Test",
            "nonexistent-binary --standalone -t html5",
            30_000,
            None,
        )
        .await
        .expect("render should not panic");
        assert!(!result.ok, "invalid command should set ok=false");
        assert!(
            result.html.contains("renderer error"),
            "error HTML should contain error marker, got: {}",
            result.html
        );
    }

    #[tokio::test]
    async fn render_preserves_markdown_formatting() {
        let result = execute_render("**bold**", "pandoc -t html5", 30_000, None)
            .await
            .expect("render should succeed");
        assert!(result.ok);
        assert!(
            result.html.contains("<strong>bold</strong>"),
            "output should contain strong tags"
        );
    }

    #[tokio::test]
    async fn render_torture_document_produces_all_expected_elements() {
        let torture_md = include_str!("../../src/tests/oracles/torture.md");
        let result = execute_render(
            torture_md,
            "pandoc -f markdown+tex_math_dollars+fenced_divs+task_lists --standalone -t html5",
            60_000,
            None,
        )
        .await
        .expect("render should succeed");
        assert!(
            result.ok,
            "torture document should render: {}",
            result.stderr
        );

        let html = &result.html;
        // Headings
        assert!(html.contains("<h1"), "should have h1");
        // Bold/italic/code
        assert!(html.contains("<strong>bold</strong>"), "bold text");
        assert!(html.contains("<em>italic</em>"), "italic text");
        assert!(html.contains("<code>inline code</code>"), "inline code");
        // Lists
        assert!(html.contains("<li>alpha</li>"), "unordered list");
        assert!(html.contains("<li>second</li>"), "ordered list");
        // Task list
        assert!(html.contains("checked"), "checked task");
        // Block quote
        assert!(html.contains("<blockquote>"), "blockquote");
        // Table
        assert!(html.contains("<table>"), "table");
        assert!(html.contains("rank"), "table header");
        // Code block
        assert!(
            html.contains("<code") || html.contains("<pre"),
            "code block present"
        );
        assert!(html.contains("square"), "code block content");
        // Link
        assert!(html.contains("https://example.com"), "link");
        // Math
        assert!(html.contains("math inline"), "math span present");
        // No renderer errors
        assert!(!html.contains("renderer error"), "no renderer errors");
    }
}
