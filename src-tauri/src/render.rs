use std::fs;
use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};

use crate::fs_utils::{normalize_path, path_is_inside};

// ─── filter path extraction (mirrors command-parser.ts) ──────────────────────

pub fn extract_filter_paths(command: &str) -> Vec<String> {
    let tokens = shell_words::split(command).unwrap_or_default();
    let mut paths = vec![];
    let mut iter = tokens.iter().skip(1).peekable();
    while let Some(arg) = iter.next() {
        if let Some(p) = arg.strip_prefix("--lua-filter=") {
            paths.push(p.to_string());
        } else if arg == "--lua-filter" {
            if let Some(next) = iter.next() {
                paths.push(next.clone());
            }
        } else if let Some(p) = arg.strip_prefix("--filter=") {
            paths.push(p.to_string());
        } else if arg == "--filter" {
            if let Some(next) = iter.next() {
                paths.push(next.clone());
            }
        }
    }
    paths
}

pub fn remove_filter_flags(command: &str, filters_dir: &Path) -> Vec<String> {
    let tokens = shell_words::split(command).unwrap_or_default();
    let mut result = vec![];
    let mut iter = tokens.iter().skip(1).peekable();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    let expand = |p: &str| -> PathBuf {
        if p.starts_with("~/") {
            home.join(&p[2..])
        } else if p == "~" {
            home.clone()
        } else {
            PathBuf::from(p)
        }
    };
    while let Some(arg) = iter.next() {
        let (filter_path, is_pair): (Option<String>, bool) =
            if let Some(p) = arg.strip_prefix("--lua-filter=") {
                (Some(p.to_string()), false)
            } else if arg == "--lua-filter" {
                let next = iter.next().cloned();
                (next, true)
            } else if let Some(p) = arg.strip_prefix("--filter=") {
                (Some(p.to_string()), false)
            } else if arg == "--filter" {
                let next = iter.next().cloned();
                (next, true)
            } else {
                result.push(arg.clone());
                continue;
            };
        if let Some(fp) = filter_path {
            let resolved = expand(&fp);
            let resolved = if resolved.is_absolute() {
                resolved
            } else {
                std::env::current_dir()
                    .unwrap_or_default()
                    .join(&resolved)
            };
            // Only drop it if it's inside filtersDir
            if !path_is_inside(filters_dir, &resolved) {
                if is_pair {
                    if arg == "--lua-filter" {
                        result.push("--lua-filter".to_string());
                    } else {
                        result.push("--filter".to_string());
                    }
                    result.push(fp);
                } else if arg.starts_with("--lua-filter=") {
                    result.push(format!("--lua-filter={}", fp));
                } else {
                    result.push(format!("--filter={}", fp));
                }
            }
        }
    }
    result
}

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
                if let Ok(bytes) = fs::read(&abs) {
                    let mime = mime_for_extension(abs.extension().unwrap_or_default().to_str().unwrap_or(""));
                    let encoded = B64.encode(&bytes);
                    result.push_str(&format!("data:{};base64,{}", mime, encoded));
                    continue;
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
    use super::*;
    use std::fs;

    #[test]
    fn extract_filter_paths_finds_lua_filter_flags() {
        let paths = extract_filter_paths(
            "pandoc --lua-filter=/a/f.lua --filter /b/f.py --lua-filter=/c/g.lua",
        );
        assert_eq!(paths, vec!["/a/f.lua", "/b/f.py", "/c/g.lua"]);
    }

    #[test]
    fn extract_filter_paths_finds_equals_form() {
        let paths = extract_filter_paths("pandoc --lua-filter=~/.pandoc/f.lua");
        assert_eq!(paths, vec!["~/.pandoc/f.lua"]);
    }

    #[test]
    fn extract_filter_paths_empty_when_no_filters() {
        let paths = extract_filter_paths("pandoc --standalone -t html5");
        assert!(paths.is_empty());
    }

    #[test]
    fn remove_filter_flags_drops_filters_inside_filters_dir() {
        let dir = tempfile::tempdir().unwrap();
        let f1 = dir.path().join("a.lua");
        let f2 = dir.path().join("b.lua");
        fs::write(&f1, "").unwrap();
        fs::write(&f2, "").unwrap();
        let cmd = format!(
            "pandoc --lua-filter={} --standalone --lua-filter={}",
            f1.display(), f2.display()
        );
        let remaining = remove_filter_flags(&cmd, dir.path());
        assert_eq!(remaining, vec!["--standalone"]);
    }

    #[test]
    fn remove_filter_flags_preserves_filters_outside_filters_dir() {
        let dir = tempfile::tempdir().unwrap();
        let cmd = "pandoc --lua-filter=/outside/f.lua --standalone";
        let remaining = remove_filter_flags(cmd, dir.path());
        assert_eq!(remaining, vec!["--lua-filter=/outside/f.lua", "--standalone"]);
    }
}
