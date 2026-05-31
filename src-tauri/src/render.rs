use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tauri::State;
use tokio::io::AsyncWriteExt;

use crate::fs_utils::{normalize_path, path_is_inside};
use crate::state::AppState;

// ─── preview asset inlining ───────────────────────────────────────────────────

/// Walk HTML output from pandoc and replace every relative `<img src="...">` with
/// an inline data URL, so the WebView receives fully self-contained HTML.
pub fn inline_preview_assets(html: &str, document_dir: &Path, workspace_root: &Path) -> String {
    // Simple regex-free replacement: scan for `src="` and resolve each path.
    let mut result = String::with_capacity(html.len());
    let mut remaining = html;
    while let Some(idx) = remaining.find("src=\"") {
        let before = &remaining[..idx + 5]; // include `src="`
        result.push_str(before);
        remaining = &remaining[idx + 5..];

        let end = match remaining.find('"') {
            Some(e) => e,
            None => {
                result.push_str(remaining);
                return result;
            }
        };
        let src = &remaining[..end];
        remaining = &remaining[end..]; // keep closing `"`

        // Only inline relative, non-data paths
        if src.starts_with("data:")
            || src.starts_with("http://")
            || src.starts_with("https://")
            || src.starts_with("//")
        {
            result.push_str(src);
        } else {
            let abs = if Path::new(src).is_absolute() {
                PathBuf::from(src)
            } else {
                document_dir.join(src)
            };
            let abs = normalize_path(&abs);
            // Security: only serve files inside workspace or document_dir
            if (path_is_inside(document_dir, &abs) || path_is_inside(workspace_root, &abs))
                && abs.is_file()
            {
                match fs::read(&abs) {
                    Ok(bytes) => {
                        let mime = mime_for_extension(
                            abs.extension().unwrap_or_default().to_str().unwrap_or(""),
                        );
                        let encoded = B64.encode(&bytes);
                        result.push_str(&format!("data:{};base64,{}", mime, encoded));
                        continue;
                    }
                    Err(e) => log::warn!("Failed to inline preview asset {}: {}", abs.display(), e),
                }
            }
            result.push_str(src);
        }
    }
    result.push_str(remaining);
    result
}

pub fn mime_for_extension(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

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
    document_dir: &Path,
    workspace_root: &Path,
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

    let inlined = inline_preview_assets(&stdout, document_dir, workspace_root);

    Ok(RenderResult {
        html: inlined,
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
    let (document_dir, workspace_root) = {
        let s = state.lock().unwrap();
        (s.document_root(), s.workspace_root())
    };
    execute_render(
        &markdown,
        &command,
        timeout_ms,
        doc_path_ref,
        &document_dir,
        &workspace_root,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn render_basic_markdown_produces_html() {
        let dir = PathBuf::from("/tmp");
        let result = execute_render(
            "# Hello\n\nWorld",
            "pandoc --standalone -t html5",
            30_000,
            None,
            &dir,
            &dir,
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
        let dir = PathBuf::from("/tmp");
        let result = execute_render("", "pandoc --standalone -t html5", 30_000, None, &dir, &dir)
            .await
            .expect("render should succeed");
        assert!(result.ok, "empty input should succeed");
    }

    #[tokio::test]
    async fn render_invalid_command_returns_error() {
        let dir = PathBuf::from("/tmp");
        let result = execute_render(
            "# Test",
            "nonexistent-binary --standalone -t html5",
            30_000,
            None,
            &dir,
            &dir,
        )
        .await
        .expect("render should not panic");
        assert!(
            !result.ok,
            "invalid command should set ok=false"
        );
        assert!(
            result.html.contains("renderer error"),
            "error HTML should contain error marker, got: {}",
            result.html
        );
    }

    #[tokio::test]
    async fn render_preserves_markdown_formatting() {
        let dir = PathBuf::from("/tmp");
        let result = execute_render("**bold**", "pandoc -t html5", 30_000, None, &dir, &dir)
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
        let dir = PathBuf::from("/tmp");
        let result = execute_render(
            torture_md,
            "pandoc -f markdown+tex_math_dollars+fenced_divs+task_lists --standalone -t html5",
            60_000,
            None,
            &dir,
            &dir,
        )
        .await
        .expect("render should succeed");
        assert!(result.ok, "torture document should render: {}", result.stderr);

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
        assert!(html.contains("<code") || html.contains("<pre"), "code block present");
        assert!(html.contains("square"), "code block content");
        // Link
        assert!(html.contains("https://example.com"), "link");
        // Math
        assert!(html.contains("math inline"), "math span present");
        // No renderer errors
        assert!(!html.contains("renderer error"), "no renderer errors");
    }
}
