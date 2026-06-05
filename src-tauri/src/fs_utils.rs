use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use std::time::UNIX_EPOCH;
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

pub fn to_client_path(root: &Path, absolute: &Path) -> Result<String, String> {
    absolute
        .strip_prefix(root)
        .map(|rel| rel.to_string_lossy().into_owned())
        .map_err(|e| {
            format!(
                "failed to resolve client path: path {} is outside root {}: {}",
                absolute.display(),
                root.display(),
                e
            )
        })
}

// ─── ignore / text detection ─────────────────────────────────────────────────

pub const IGNORE_NAMES: &[&str] = &[".git", "node_modules", "dist", "build", "coverage"];

const MARKDOWN_EXTENSIONS: &[&str] = &[".md", ".mdown", ".markdown"];

pub fn should_ignore(workspace_root: &Path, absolute_path: &Path) -> bool {
    let Ok(client_path) = to_client_path(workspace_root, absolute_path) else {
        return true;
    };
    client_path
        .split('/')
        .any(|part| part.starts_with('.') || IGNORE_NAMES.contains(&part))
}

pub fn is_text_like_file(path: &Path) -> Result<bool, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .ok_or_else(|| format!("invalid file path (no filename): {}", path.display()))?;
    if name == "justfile" {
        return Ok(true);
    }
    
    // Read only the first 1024 bytes for inspection to avoid loading large binaries
    use std::io::Read;
    let mut file = fs::File::open(path)
        .map_err(|e| format!("failed to open file {}: {e}", path.display()))?;
    let mut buffer = [0; 1024];
    let n = file.read(&mut buffer)
        .map_err(|e| format!("failed to read file sample {}: {e}", path.display()))?;
        
    Ok(content_inspector::inspect(&buffer[..n]).is_text())
}

pub fn is_markdown_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    MARKDOWN_EXTENSIONS.contains(&ext.as_str())
}

// ─── fingerprint ─────────────────────────────────────────────────────────────

pub fn get_file_fingerprint(path: &Path) -> Result<Option<FileFingerprint>, String> {
    let meta = fs::metadata(path)
        .map_err(|e| format!("failed to read metadata for {}: {e}", path.display()))?;
    if !meta.is_file() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let hash = hex::encode(hasher.finalize());
    let mtime_ms = meta
        .modified()
        .map_err(|e| format!("failed to read modified time for {}: {e}", path.display()))?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("invalid modified time for {}: {e}", path.display()))?
        .as_millis() as u64;
    Ok(Some(FileFingerprint { mtime_ms, hash }))
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
    let sanitized = sanitize_filename::sanitize(filename);
    if sanitized.is_empty() {
        format!("figure-{}{}", Uuid::new_v4(), image_extension(mime_type))
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn should_ignore_hidden_path_segments() {
        assert!(should_ignore(Path::new("/ws"), Path::new("/ws/.hidden.md"),));
        assert!(should_ignore(
            Path::new("/ws"),
            Path::new("/ws/nested/.secret/file.md"),
        ));
    }

    #[test]
    fn should_ignore_named_debris_directories() {
        assert!(should_ignore(
            Path::new("/ws"),
            Path::new("/ws/node_modules/pkg/index.js"),
        ));
        assert!(!should_ignore(
            Path::new("/ws"),
            Path::new("/ws/nested/file.md"),
        ));
    }

    #[test]
    fn resolve_inside_rejects_parent_dir_escape() {
        assert!(resolve_inside(Path::new("/ws/sub"), "../outside").is_err());
    }
}
