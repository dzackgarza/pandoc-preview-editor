use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

use crate::fs_utils::{normalize_path, path_is_inside};

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

#[cfg(test)]
mod tests {
    // Tests for preview asset inlining (render module)
}
