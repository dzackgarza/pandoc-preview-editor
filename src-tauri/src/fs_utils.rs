use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::state::FileFingerprint;

// ─── path utilities ──────────────────────────────────────────────────────────





pub fn path_is_inside(root: &Path, target: &Path) -> bool {
    match target.strip_prefix(root) {
        Ok(_) => true,
        Err(_) => false,
    }
}

pub fn resolve_inside(root: &Path, path_from_client: &str) -> Result<PathBuf, String> {
    let target = if path_from_client.is_empty() {
        root.to_path_buf()
    } else {
        root.join(path_from_client)
    };
    // Normalize without requiring the path to exist
    let target = normalize_path(&target);
    if !path_is_inside(root, &target) {
        return Err("path escapes workspace root".to_string());
    }
    Ok(target)
}

pub fn normalize_path(path: &Path) -> PathBuf {
    path_clean::clean(path)
}

pub fn to_client_path(root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(root)
        .map(|rel| rel.to_string_lossy().into_owned())
        .unwrap_or_else(|_| absolute.to_string_lossy().into_owned())
}

// ─── ignore / text detection ─────────────────────────────────────────────────

pub const IGNORE_NAMES: &[&str] = &[
    ".git", "node_modules", "dist", "build", "coverage",
];

const TEXT_EXTENSIONS: &[&str] = &[
    ".bib", ".css", ".csv", ".htm", ".html", ".js", ".json", ".jsx", ".log",
    ".lua", ".md", ".mdown", ".markdown", ".mjs", ".rst", ".sh", ".tex",
    ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
];

const BINARY_EXTENSIONS: &[&str] = &[
    ".7z", ".avif", ".bin", ".exe", ".gif", ".gz", ".ico", ".jpeg", ".jpg",
    ".pdf", ".png", ".tar", ".tgz", ".webp", ".zip", ".zst",
];

const MARKDOWN_EXTENSIONS: &[&str] = &[".md", ".mdown", ".markdown"];

pub fn should_ignore(workspace_root: &Path, absolute_path: &Path) -> bool {
    let client_path = to_client_path(workspace_root, absolute_path);
    if client_path == "archive/test-results"
        || client_path.starts_with("archive/test-results/")
    {
        return true;
    }
    client_path
        .split('/')
        .any(|part| IGNORE_NAMES.contains(&part))
}

pub fn is_text_like_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name == "justfile" {
        return true;
    }
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    if BINARY_EXTENSIONS.contains(&ext.as_str()) {
        return false;
    }
    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return true;
    }
    // Sniff for null bytes
    if let Ok(bytes) = fs::read(path) {
        let sample = &bytes[..bytes.len().min(1024)];
        return !sample.contains(&0u8);
    }
    false
}

pub fn is_markdown_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    MARKDOWN_EXTENSIONS.contains(&ext.as_str())
}

// ─── fingerprint ─────────────────────────────────────────────────────────────

pub fn get_file_fingerprint(path: &Path) -> Option<FileFingerprint> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let content = fs::read_to_string(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let hash = hex::encode(hasher.finalize());
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(FileFingerprint { mtime_ms, hash })
}

// ─── atomic write ─────────────────────────────────────────────────────────────

pub fn write_file_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("no parent directory")?;
    let tmp = parent.join(format!(".tmp-{}", Uuid::new_v4()));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── image extension ──────────────────────────────────────────────────────────

pub fn image_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => ".jpg",
        "image/svg+xml" => ".svg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".png",
    }
}

pub fn sanitize_figure_filename(filename: &str, mime_type: &str) -> String {
    let base = filename.split(['/', '\\']).last().unwrap_or(filename);
    let sanitized: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let sanitized = sanitized.trim_start_matches('-');
    let sanitized = &sanitized[..sanitized.len().min(120)];
    if sanitized.is_empty() {
        format!("figure-{}{}", Uuid::new_v4(), image_extension(mime_type))
    } else {
        sanitized.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn normalize_path_strips_dots() {
        assert_eq!(normalize_path(Path::new("/foo/./bar/./baz")), PathBuf::from("/foo/bar/baz"));
    }

    #[test]
    fn normalize_path_resolves_parent_dirs() {
        assert_eq!(normalize_path(Path::new("/foo/bar/../baz")), PathBuf::from("/foo/baz"));
    }

    #[test]
    fn normalize_path_noop_clean_path() {
        assert_eq!(normalize_path(Path::new("/foo/bar/baz")), PathBuf::from("/foo/bar/baz"));
    }

    #[test]
    fn path_is_inside_direct_child() {
        assert!(path_is_inside(Path::new("/ws"), Path::new("/ws/file.md")));
    }

    #[test]
    fn path_is_inside_deep_child() {
        assert!(path_is_inside(Path::new("/ws"), Path::new("/ws/a/b/c/file.md")));
    }

    #[test]
    fn path_is_inside_self() {
        assert!(path_is_inside(Path::new("/ws"), Path::new("/ws")));
    }

    #[test]
    fn path_is_outside_rejected() {
        assert!(!path_is_inside(Path::new("/ws"), Path::new("/etc/passwd")));
    }

    #[test]
    fn path_is_outside_parent_dir_escape_rejected() {
        assert!(!path_is_inside(Path::new("/ws/sub"), Path::new("/ws/../outside")));
    }

    #[test]
    fn resolve_inside_relative_path() {
        let root = Path::new("/ws");
        assert_eq!(resolve_inside(root, "sub/file.md").unwrap(), PathBuf::from("/ws/sub/file.md"));
    }

    #[test]
    fn resolve_inside_empty_path_returns_root() {
        assert_eq!(resolve_inside(Path::new("/ws"), "").unwrap(), PathBuf::from("/ws"));
    }

    #[test]
    fn resolve_inside_rejects_parent_dir_escape() {
        assert!(resolve_inside(Path::new("/ws/sub"), "../outside").is_err());
    }

    #[test]
    fn write_file_atomic_creates_and_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.md");
        write_file_atomic(&path, "hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
        write_file_atomic(&path, "world").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "world");
    }

    #[test]
    fn write_file_atomic_leaves_no_tmp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.md");
        write_file_atomic(&path, "data").unwrap();
        let tmp_count = fs::read_dir(dir.path()).unwrap().filter(|e| {
            e.as_ref().unwrap().file_name().to_string_lossy().starts_with(".tmp-")
        }).count();
        assert_eq!(tmp_count, 0);
    }

    #[test]
    fn is_markdown_file_detects_extensions() {
        assert!(is_markdown_file(Path::new("doc.md")));
        assert!(is_markdown_file(Path::new("doc.mdown")));
        assert!(is_markdown_file(Path::new("doc.markdown")));
        assert!(!is_markdown_file(Path::new("doc.txt")));
        assert!(!is_markdown_file(Path::new("doc.tex")));
    }

    #[test]
    fn is_text_like_file_detects_known_text_types() {
        assert!(is_text_like_file(Path::new("doc.md")));
        assert!(is_text_like_file(Path::new("doc.tex")));
        assert!(is_text_like_file(Path::new("doc.toml")));
        assert!(is_text_like_file(Path::new("justfile")));
    }

    #[test]
    fn is_text_like_file_rejects_binaries() {
        assert!(!is_text_like_file(Path::new("photo.png")));
        assert!(!is_text_like_file(Path::new("doc.pdf")));
        assert!(!is_text_like_file(Path::new("archive.zip")));
    }

    #[test]
    fn is_text_like_file_sniffs_null_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("unknown.bin");
        fs::write(&path, b"\x00\x00hello").unwrap();
        assert!(!is_text_like_file(&path));
        let path2 = dir.path().join("unknown.txt");
        fs::write(&path2, b"hello world").unwrap();
        assert!(is_text_like_file(&path2));
    }

    #[test]
    fn sanitize_figure_filename_cleans_special_chars() {
        let result = sanitize_figure_filename("my diagram (1).png", "image/png");
        assert!(result.starts_with("my-diagram--1-"));
        assert!(result.ends_with(".png"));
    }

    #[test]
    fn sanitize_figure_filename_handles_empty_input() {
        let result = sanitize_figure_filename("", "image/png");
        assert!(result.starts_with("figure-"));
        assert!(result.ends_with(".png"));
    }

    #[test]
    fn sanitize_figure_filename_preserves_valid_name() {
        let result = sanitize_figure_filename("my-diagram.tikz", "image/png");
        assert_eq!(result, "my-diagram.tikz");
    }
}
