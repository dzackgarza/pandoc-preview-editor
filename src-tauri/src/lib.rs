// pandoc-preview Tauri backend
// All Express endpoints are ported here as Tauri commands.
// State previously held in createApp() closure lives in AppState (Mutex-guarded).

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use dirs;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

// ─── types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub command: String,
    pub args: Vec<String>,
    pub output: Option<String>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FigureEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub documents: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FiguresRegistry {
    pub figures: Vec<FigureEntry>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileFingerprint {
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: u64,
    pub hash: String,
}

// ─── app state ──────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct AppState {
    pub render_command: String,
    pub timeout_ms: u64,
    pub file: Option<PathBuf>,
    pub file_content: Option<String>,
    pub workspace_root: Option<PathBuf>,
    pub is_temp_file: bool,
    pub config_path: Option<PathBuf>,
    pub templates_dir: PathBuf,
    pub filters_dir: PathBuf,
    pub debounce_ms: u64,
    pub launcher_command: Option<String>,
    pub recovered_from_backup: bool,
    pub restore_last_file: bool,
    pub figures_storage_strategy: FiguresStorageStrategy,
    pub figures_central_directory: Option<PathBuf>,
    pub plugins: Vec<PluginManifest>,
    pub recent_files: Vec<PathBuf>,
    pub file_fingerprints: HashMap<String, FileFingerprint>,
    pub tool_state: HashMap<String, ToolEntry>,
}

#[derive(Debug, Clone)]
pub enum FiguresStorageStrategy {
    Relative,
    Central,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolEntry {
    pub installed: bool,
    pub cmd: String,
}

impl AppState {
    pub fn workspace_root(&self) -> PathBuf {
        if let Some(ref root) = self.workspace_root {
            return root.clone();
        }
        if let Some(ref file) = self.file {
            if let Some(parent) = file.parent() {
                return parent.to_path_buf();
            }
        }
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    }

    pub fn document_root(&self) -> PathBuf {
        if let Some(ref file) = self.file {
            if !self.is_temp_file {
                if let Some(parent) = file.parent() {
                    return parent.to_path_buf();
                }
            }
        }
        self.workspace_root()
    }

    pub fn current_file_content(&self) -> String {
        if let Some(ref path) = self.file {
            let backup = get_backup_path(path);
            if backup.exists() {
                if let Ok(content) = fs::read_to_string(&backup) {
                    return content;
                }
            }
            if path.exists() {
                if let Ok(content) = fs::read_to_string(path) {
                    return content;
                }
            }
        }
        self.file_content.clone().unwrap_or_default()
    }
}

// ─── path utilities ──────────────────────────────────────────────────────────

fn xdg_state_dir() -> PathBuf {
    let base = std::env::var("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::home_dir().expect("HOME must be set").join(".local/state"));
    base.join("pandoc-preview")
}

fn backup_dir() -> PathBuf {
    xdg_state_dir().join("backups")
}

fn state_file_path() -> PathBuf {
    xdg_state_dir().join("state.json")
}

fn get_backup_path(document_path: &Path) -> PathBuf {
    let canonical = document_path
        .canonicalize()
        .unwrap_or_else(|_| document_path.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let hash = hex::encode(hasher.finalize());
    backup_dir().join(format!("{}.md", hash))
}

fn path_is_inside(root: &Path, target: &Path) -> bool {
    match target.strip_prefix(root) {
        Ok(_) => true,
        Err(_) => false,
    }
}

fn resolve_inside(root: &Path, path_from_client: &str) -> Result<PathBuf, String> {
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

fn normalize_path(path: &Path) -> PathBuf {
    path_clean::clean(path)
}

fn to_client_path(root: &Path, absolute: &Path) -> String {
    absolute
        .strip_prefix(root)
        .map(|rel| rel.to_string_lossy().into_owned())
        .unwrap_or_else(|_| absolute.to_string_lossy().into_owned())
}

// ─── ignore / text detection ─────────────────────────────────────────────────

const IGNORE_NAMES: &[&str] = &[
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

fn should_ignore(workspace_root: &Path, absolute_path: &Path) -> bool {
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

fn is_text_like_file(path: &Path) -> bool {
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

fn is_markdown_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    MARKDOWN_EXTENSIONS.contains(&ext.as_str())
}

// ─── fingerprint ─────────────────────────────────────────────────────────────

fn get_file_fingerprint(path: &Path) -> Option<FileFingerprint> {
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

// ─── session state ────────────────────────────────────────────────────────────

fn save_session_state(last_file: &Path, is_temp_file: bool) {
    let dir = xdg_state_dir();
    let _ = fs::create_dir_all(&dir);
    let state = serde_json::json!({
        "last_file": last_file.to_string_lossy(),
        "is_temp_file": is_temp_file,
    });
    let _ = fs::write(state_file_path(), serde_json::to_string_pretty(&state).unwrap());
}

// ─── figures registry ─────────────────────────────────────────────────────────

fn load_figures_registry(dir: &Path) -> FiguresRegistry {
    let registry_path = dir.join("registry.json");
    if registry_path.exists() {
        if let Ok(content) = fs::read_to_string(&registry_path) {
            if let Ok(reg) = serde_json::from_str::<FiguresRegistry>(&content) {
                return reg;
            }
        }
    }
    FiguresRegistry { figures: vec![] }
}

fn save_figures_registry(dir: &Path, registry: &FiguresRegistry) {
    let _ = fs::create_dir_all(dir);
    let path = dir.join("registry.json");
    let _ = fs::write(path, serde_json::to_string_pretty(registry).unwrap());
}

fn default_figures_central_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".pandoc/figures")
}

fn figures_central_dir(state: &AppState) -> PathBuf {
    state
        .figures_central_directory
        .clone()
        .unwrap_or_else(default_figures_central_dir)
}

fn register_figure(state: &AppState, name: &str, absolute_path: &Path, kind: &str) {
    let central_dir = figures_central_dir(state);
    let mut registry = load_figures_registry(&central_dir);
    let doc_path = state
        .file
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let abs_str = absolute_path.to_string_lossy().into_owned();
    if let Some(entry) = registry.figures.iter_mut().find(|f| f.path == abs_str) {
        if !doc_path.is_empty() && !entry.documents.contains(&doc_path) {
            entry.documents.push(doc_path);
        }
    } else {
        registry.figures.push(FigureEntry {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            path: abs_str,
            kind: kind.to_string(),
            created_at: chrono_now(),
            documents: if doc_path.is_empty() {
                vec![]
            } else {
                vec![doc_path]
            },
        });
    }
    save_figures_registry(&central_dir, &registry);
}

fn chrono_now() -> String {
    // ISO-8601-ish timestamp without pulling in chrono
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

// ─── plugins ──────────────────────────────────────────────────────────────────

fn load_bundled_plugins(plugin_dir: &Path) -> Vec<PluginManifest> {
    if !plugin_dir.exists() {
        return vec![];
    }
    let mut manifests = vec![];
    if let Ok(entries) = fs::read_dir(plugin_dir) {
        let mut names: Vec<_> = entries
            .flatten()
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|x| x == "toml")
                    .unwrap_or(false)
            })
            .map(|e| e.path())
            .collect();
        names.sort();
        for path in names {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(manifest) = toml_edit::de::from_str::<PluginManifest>(&content) {
                    manifests.push(manifest);
                }
            }
        }
    }
    manifests
}

fn interpolate_plugin_arg(arg: &str, file_path: &Path) -> String {
    let file_str = file_path.to_string_lossy();
    let stem = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dir = file_path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    arg.replace("${FILE}", &file_str)
        .replace("${FILE_STEM}", &stem)
        .replace("${FILE_DIR}", &dir)
}

// ─── tool discovery ───────────────────────────────────────────────────────────

fn is_command_available(cmd: &str) -> bool {
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in path_var.split(':') {
        let full = PathBuf::from(dir).join(cmd);
        if full.exists() {
            return true;
        }
    }
    false
}

// ─── diagram tool definitions ─────────────────────────────────────────────────

struct DiagramToolDef {
    id: &'static str,
    executables: &'static [&'static str],
    ext: &'static str,
    starter_template: &'static str,
}

static DIAGRAM_TOOLS: &[DiagramToolDef] = &[
    DiagramToolDef {
        id: "qtikz",
        executables: &["qtikz"],
        ext: ".tikz",
        starter_template:
            "\\begin{tikzpicture}\n  \\draw (0,0) circle (1in);\n\\end{tikzpicture}\n",
    },
    DiagramToolDef {
        id: "tikzit",
        executables: &["tikzit"],
        ext: ".tikz",
        starter_template:
            "\\begin{tikzpicture}\n  \\draw (0,0) circle (1in);\n\\end{tikzpicture}\n",
    },
    DiagramToolDef {
        id: "inkscape",
        executables: &["inkscape"],
        ext: ".svg",
        starter_template: "",
    },
    DiagramToolDef {
        id: "drawio",
        executables: &["drawio", "draw.io"],
        ext: ".drawio",
        starter_template: "",
    },
    DiagramToolDef {
        id: "xournal",
        executables: &["xournal"],
        ext: ".xoj",
        starter_template: "",
    },
    DiagramToolDef {
        id: "xournalpp",
        executables: &["xournalpp"],
        ext: ".xopp",
        starter_template: "",
    },
    DiagramToolDef {
        id: "ipe",
        executables: &["ipe"],
        ext: ".ipe",
        starter_template: "",
    },
];

fn probe_tool_state() -> HashMap<String, ToolEntry> {
    let mut map = HashMap::new();
    for tool in DIAGRAM_TOOLS {
        let found = tool.executables.iter().find(|e| is_command_available(e));
        let cmd = found
            .cloned()
            .unwrap_or(tool.executables[0])
            .to_string();
        map.insert(
            tool.id.to_string(),
            ToolEntry {
                installed: found.is_some(),
                cmd,
            },
        );
    }
    map
}

fn tool_ext(tool_id: &str) -> &'static str {
    DIAGRAM_TOOLS
        .iter()
        .find(|t| t.id == tool_id)
        .map(|t| t.ext)
        .unwrap_or(".svg")
}

fn tool_id_for_ext(ext: &str) -> &'static str {
    DIAGRAM_TOOLS
        .iter()
        .find(|t| t.ext == ext)
        .map(|t| t.id)
        .unwrap_or("inkscape")
}

fn starter_template_for_tool(tool_id: &str) -> &'static str {
    DIAGRAM_TOOLS
        .iter()
        .find(|t| t.id == tool_id)
        .map(|t| t.starter_template)
        .unwrap_or("")
}

// ─── atomic write ─────────────────────────────────────────────────────────────

fn write_file_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("no parent directory")?;
    let tmp = parent.join(format!(".tmp-{}", Uuid::new_v4()));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── image extension ──────────────────────────────────────────────────────────

fn image_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => ".jpg",
        "image/svg+xml" => ".svg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".png",
    }
}

fn sanitize_figure_filename(filename: &str, mime_type: &str) -> String {
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

// ─── filter path extraction (mirrors command-parser.ts) ──────────────────────

fn extract_filter_paths(command: &str) -> Vec<String> {
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

fn remove_filter_flags(command: &str, filters_dir: &Path) -> Vec<String> {
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
fn inline_preview_assets(html: &str, document_dir: &Path, workspace_root: &Path) -> String {
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

fn mime_for_extension(ext: &str) -> &'static str {
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

// ─── TOML config writing ──────────────────────────────────────────────────────

fn write_config_toml(
    path: &Path,
    debounce_ms: u64,
    timeout_ms: u64,
    restore_last_file: bool,
    render_command: &str,
    templates_dir: &str,
    filters_dir: &str,
) -> Result<(), String> {
    let mut doc = toml_edit::DocumentMut::new();
    doc["render"]["debounce_ms"] = toml_edit::value(debounce_ms as i64);
    doc["render"]["timeout_ms"] = toml_edit::value(timeout_ms as i64);
    doc["render"]["restore_last_file"] = toml_edit::value(restore_last_file);
    doc["pandoc"]["render_command"] = toml_edit::value(render_command);
    doc["pandoc"]["templates_dir"] = toml_edit::value(templates_dir);
    doc["pandoc"]["filters_dir"] = toml_edit::value(filters_dir);
    fs::write(path, doc.to_string()).map_err(|e| e.to_string())
}

#[derive(Debug, serde::Deserialize, Default)]
struct TomlConfig {
    render: Option<TomlRenderSection>,
    pandoc: Option<TomlPandocSection>,
}

#[derive(Debug, serde::Deserialize, Default)]
struct TomlRenderSection {
    debounce_ms: Option<u64>,
    timeout_ms: Option<u64>,
    restore_last_file: Option<bool>,
}

#[derive(Debug, serde::Deserialize, Default)]
struct TomlPandocSection {
    render_command: Option<String>,
    templates_dir: Option<String>,
    filters_dir: Option<String>,
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_initial_state(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    let has_backup = if let Some(ref file) = s.file {
        s.recovered_from_backup || get_backup_path(file).exists()
    } else {
        false
    };
    serde_json::json!({
        "content": s.current_file_content(),
        "file": s.file.as_ref().filter(|_| !s.is_temp_file).map(|p| p.to_string_lossy()),
        "tempBackupFile": if s.is_temp_file { s.file.as_ref().map(|p| p.to_string_lossy().into_owned()) } else { None },
        "workspaceRoot": s.workspace_root().to_string_lossy(),
        "isTempFile": s.is_temp_file,
        "recoveredFromBackup": has_backup,
    })
}

// ─── render ───────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct RenderResult {
    html: String,
    #[serde(rename = "durationMs")]
    duration_ms: u64,
    ok: bool,
    stderr: String,
}

#[tauri::command]
async fn render(
    markdown: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RenderResult, String> {
    let (command, timeout_ms, doc_path) = {
        let s = state.lock().unwrap();
        (
            s.render_command.clone(),
            s.timeout_ms,
            s.file.clone(),
            )
    };

    let started = std::time::Instant::now();

    let mut cmd = tokio::process::Command::new("zsh");
    cmd.arg("-c").arg(&command);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(ref path) = doc_path {
        cmd.env("PANDOC_DOC_PATH", path.to_string_lossy().as_ref());
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(markdown.as_bytes()).await.map_err(|e| e.to_string())?;
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

    // Inline assets so the WebView iframe gets self-contained HTML
    let (document_dir, workspace_root) = {
        let s = state.lock().unwrap();
        (s.document_root(), s.workspace_root())
    };
    let inlined = inline_preview_assets(&stdout, &document_dir, &workspace_root);

    Ok(RenderResult {
        html: inlined,
        duration_ms,
        ok: true,
        stderr: stderr_text,
    })
}

// ─── save ─────────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct SaveResult {
    ok: bool,
    path: String,
    #[serde(rename = "workspaceRoot")]
    workspace_root: String,
}

#[tauri::command]
fn save(
    markdown: String,
    path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<SaveResult, String> {
    let mut s = state.lock().unwrap();
    let workspace_root = s.workspace_root();

    let target_path: PathBuf = if let Some(ref p) = path {
        if !p.is_empty() {
            if Path::new(p).is_absolute() {
                PathBuf::from(p)
            } else {
                resolve_inside(&workspace_root, p)?
            }
        } else {
            s.file.clone().ok_or("no file path configured or provided")?
        }
    } else {
        s.file.clone().ok_or("no file path configured or provided")?
    };

    // Check for external modification
    if target_path.exists() {
        if let Some(registered) = s.file_fingerprints.get(&target_path.to_string_lossy().into_owned()) {
            if let Some(disk_fp) = get_file_fingerprint(&target_path) {
                if disk_fp.mtime_ms != registered.mtime_ms && disk_fp.hash != registered.hash {
                    return Err("The file has been modified externally.".into());
                }
            }
        }
    }

    let old_path = s.file.clone();
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_file_atomic(&target_path, &markdown)?;

    // Update fingerprint
    if let Some(fp) = get_file_fingerprint(&target_path) {
        s.file_fingerprints
            .insert(target_path.to_string_lossy().into_owned(), fp);
    }

    // Track recent
    track_recent(&mut s.recent_files, &target_path);

    // Update config file / workspace root
    if let Some(ref p) = path {
        if !p.is_empty() && Some(&target_path) != s.file.as_ref() {
            let new_ws = if path_is_inside(&workspace_root, &target_path) {
                workspace_root.clone()
            } else {
                target_path.parent().unwrap_or(&target_path).to_path_buf()
            };
            s.file = Some(target_path.clone());
            s.is_temp_file = false;
            s.workspace_root = Some(new_ws);
        }
    } else if s.file.as_ref() == Some(&target_path) {
        s.is_temp_file = false;
    }

    // Clean up old backup
    if let Some(ref old) = old_path {
        let old_backup = get_backup_path(old);
        let _ = fs::remove_file(&old_backup);
    }
    let target_backup = get_backup_path(&target_path);
    let _ = fs::remove_file(&target_backup);

    save_session_state(&target_path, s.is_temp_file);

    Ok(SaveResult {
        ok: true,
        path: target_path.to_string_lossy().into_owned(),
        workspace_root: s.workspace_root().to_string_lossy().into_owned(),
    })
}

// ─── backup ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn backup(
    markdown: String,
    path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();

    let doc_path: PathBuf = if let Some(ref p) = path {
        if !p.is_empty() {
            if Path::new(p).is_absolute() {
                PathBuf::from(p)
            } else {
                resolve_inside(&workspace_root, p)?
            }
        } else {
            s.file.clone().ok_or("No active file or path provided for backup")?
        }
    } else {
        s.file.clone().ok_or("No active file or path provided for backup")?
    };

    let backup_path = get_backup_path(&doc_path);
    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&backup_path, &markdown).map_err(|e| e.to_string())?;

    if Some(&doc_path) == s.file.as_ref() && s.is_temp_file {
        fs::write(&doc_path, &markdown).map_err(|e| e.to_string())?;
    }

    let is_temp = if Some(&doc_path) == s.file.as_ref() {
        s.is_temp_file
    } else {
        false
    };
    save_session_state(&doc_path, is_temp);

    Ok(serde_json::json!({
        "ok": true,
        "backupPath": backup_path.to_string_lossy(),
    }))
}

// ─── files ────────────────────────────────────────────────────────────────────

#[tauri::command]
fn browse(dir: String) -> Result<serde_json::Value, String> {
    let target_dir = PathBuf::from(&dir);
    let meta = fs::metadata(&target_dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err("dir must be a directory".into());
    }

    const BROWSE_IGNORE: &[&str] = IGNORE_NAMES;
    let mut entries: Vec<serde_json::Value> = fs::read_dir(&target_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || BROWSE_IGNORE.contains(&name.as_str()) {
                return None;
            }
            let abs = entry.path();
            let kind = if abs.is_dir() { "directory" } else { "file" };
            Some(serde_json::json!({
                "name": name,
                "absolutePath": abs.to_string_lossy(),
                "kind": kind,
            }))
        })
        .collect();
    entries.sort_by(|a, b| {
        let ka = a["kind"].as_str().unwrap_or("");
        let kb = b["kind"].as_str().unwrap_or("");
        let na = a["name"].as_str().unwrap_or("");
        let nb = b["name"].as_str().unwrap_or("");
        if ka != kb {
            return if ka == "directory" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        na.cmp(nb)
    });

    let parent_path = target_dir.parent().map(|p| p.to_string_lossy().into_owned());
    let parent = if parent_path.as_deref() == Some(target_dir.to_string_lossy().as_ref()) {
        serde_json::Value::Null
    } else {
        parent_path.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
    };

    Ok(serde_json::json!({
        "dir": target_dir.to_string_lossy(),
        "parent": parent,
        "entries": entries,
    }))
}

#[tauri::command]
fn list_files(
    dir: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target_dir = resolve_inside(&workspace_root, dir.as_deref().unwrap_or(""))?;
    let meta = fs::metadata(&target_dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err("dir must reference a directory".into());
    }

    let mut entries: Vec<serde_json::Value> = fs::read_dir(&target_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let abs = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let client_path = to_client_path(&workspace_root, &abs);
            if should_ignore(&workspace_root, &abs) {
                return None;
            }
            if abs.is_dir() {
                return Some(serde_json::json!({
                    "name": name,
                    "path": client_path,
                    "kind": "directory",
                }));
            }
            if abs.is_file() && is_text_like_file(&abs) {
                return Some(serde_json::json!({
                    "name": name,
                    "path": client_path,
                    "kind": "file",
                }));
            }
            None
        })
        .collect();
    entries.sort_by(|a, b| {
        let ka = a["kind"].as_str().unwrap_or("");
        let kb = b["kind"].as_str().unwrap_or("");
        let na = a["name"].as_str().unwrap_or("");
        let nb = b["name"].as_str().unwrap_or("");
        if ka != kb {
            return if ka == "directory" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        na.cmp(nb)
    });

    Ok(serde_json::json!({
        "root": workspace_root.to_string_lossy(),
        "dir": to_client_path(&workspace_root, &target_dir),
        "entries": entries,
    }))
}

fn collect_markdown_files(workspace_root: &Path, dir: &Path) -> Vec<serde_json::Value> {
    let mut results = vec![];
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return results,
    };
    let mut children: Vec<_> = entries.flatten().collect();
    children.sort_by_key(|e| e.file_name());
    for entry in children {
        let abs = entry.path();
        if should_ignore(workspace_root, &abs) {
            continue;
        }
        if abs.is_dir() {
            results.extend(collect_markdown_files(workspace_root, &abs));
        } else if abs.is_file() && is_markdown_file(&abs) {
            let path = to_client_path(workspace_root, &abs);
            let name = abs
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let dir_part = {
                let d = path.rsplit('/').skip(1).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/");
                d
            };
            results.push(serde_json::json!({
                "path": path,
                "absolutePath": abs.to_string_lossy(),
                "name": name,
                "dir": dir_part,
                "recent": false,
            }));
        }
    }
    results
}

#[tauri::command]
fn quick_open(
    q: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let query = q.unwrap_or_default().trim().to_lowercase();

    let workspace_entries = collect_markdown_files(&workspace_root, &workspace_root);

    let recent_entries: Vec<serde_json::Value> = s
        .recent_files
        .iter()
        .filter(|p| {
            path_is_inside(&workspace_root, p)
                && p.exists()
                && p.is_file()
                && is_markdown_file(p)
                && !should_ignore(&workspace_root, p)
        })
        .map(|p| {
            let path = to_client_path(&workspace_root, p);
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let dir_part = path.rsplit('/').skip(1).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/");
            serde_json::json!({
                "path": path,
                "absolutePath": p.to_string_lossy(),
                "name": name,
                "dir": dir_part,
                "recent": true,
            })
        })
        .collect();

    let recent_paths: std::collections::HashSet<String> = recent_entries
        .iter()
        .filter_map(|e| e["path"].as_str().map(String::from))
        .collect();

    let matches = |entry: &serde_json::Value| -> bool {
        if query.is_empty() {
            return true;
        }
        let name = entry["name"].as_str().unwrap_or("").to_lowercase();
        let path = entry["path"].as_str().unwrap_or("").to_lowercase();
        name.contains(&query) || path.contains(&query)
    };

    let mut entries: Vec<serde_json::Value> = recent_entries
        .into_iter()
        .filter(|e| matches(e))
        .collect();
    entries.extend(
        workspace_entries
            .into_iter()
            .filter(|e| {
                !recent_paths.contains(e["path"].as_str().unwrap_or("")) && matches(e)
            }),
    );

    Ok(serde_json::json!({
        "root": workspace_root.to_string_lossy(),
        "entries": entries,
    }))
}

#[tauri::command]
fn file_content(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target_path = resolve_inside(&workspace_root, &path)?;
    let meta = fs::metadata(&target_path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("path must reference a file".into());
    }
    if !is_text_like_file(&target_path) {
        return Err("file does not look like text".into());
    }
    let content = fs::read_to_string(&target_path).map_err(|e| e.to_string())?;

    if let Some(fp) = get_file_fingerprint(&target_path) {
        s.file_fingerprints
            .insert(target_path.to_string_lossy().into_owned(), fp);
    }
    track_recent(&mut s.recent_files, &target_path);
    s.file = Some(target_path.clone());
    s.is_temp_file = false;
    save_session_state(&target_path, false);

    let client_path = to_client_path(&workspace_root, &target_path);
    Ok(serde_json::json!({
        "path": client_path,
        "absolutePath": target_path.to_string_lossy(),
        "content": content,
    }))
}

#[tauri::command]
fn file_exists(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        resolve_inside(&workspace_root, &path)?
    };
    Ok(serde_json::json!({ "exists": target.exists() }))
}

#[tauri::command]
fn new_file(
    path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target_path = if let Some(ref p) = path {
        if !p.is_empty() {
            if Path::new(p).is_absolute() {
                PathBuf::from(p)
            } else {
                resolve_inside(&workspace_root, p)?
            }
        } else {
            resolve_inside(&workspace_root, &format!("untitled-{}.md", Uuid::new_v4()))?
        }
    } else {
        resolve_inside(&workspace_root, &format!("untitled-{}.md", Uuid::new_v4()))?
    };

    if target_path.exists() {
        return Err("file already exists".into());
    }
    track_recent(&mut s.recent_files, &target_path);
    s.file = Some(target_path.clone());
    s.file_content = Some(String::new());
    s.is_temp_file = false;
    s.workspace_root = Some(
        target_path
            .parent()
            .unwrap_or(&target_path)
            .to_path_buf(),
    );
    save_session_state(&target_path, false);

    Ok(serde_json::json!({
        "ok": true,
        "path": target_path.to_string_lossy(),
        "absolutePath": target_path.to_string_lossy(),
        "content": "",
        "workspaceRoot": s.workspace_root().to_string_lossy(),
    }))
}

#[tauri::command]
fn open_file_external(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        resolve_inside(&workspace_root, &path)?
    };
    drop(s);
    std::process::Command::new("xdg-open")
        .arg(&target)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

fn track_recent(recent: &mut Vec<PathBuf>, path: &Path) {
    recent.retain(|p| p != path);
    recent.insert(0, path.to_path_buf());
    recent.truncate(10);
}

// ─── pandoc assets ────────────────────────────────────────────────────────────

#[tauri::command]
fn pandoc_assets(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let mut templates: Vec<String> = vec![];
    let mut filters: Vec<String> = vec![];

    if s.templates_dir.exists() {
        if let Ok(entries) = fs::read_dir(&s.templates_dir) {
            templates = entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    (name.ends_with(".html") || name.ends_with(".template"))
                        && e.path().is_file()
                })
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
        }
    }

    if s.filters_dir.exists() {
        if let Ok(entries) = fs::read_dir(&s.filters_dir) {
            filters = entries
                .flatten()
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
        }
    }

    Ok(serde_json::json!({ "templates": templates, "filters": filters }))
}

// ─── config ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_config(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    serde_json::json!({
        "templatesDir": s.templates_dir.to_string_lossy(),
        "filtersDir": s.filters_dir.to_string_lossy(),
        "debounceMs": s.debounce_ms,
        "timeoutMs": s.timeout_ms,
        "renderCommand": s.render_command,
        "restoreLastFile": s.restore_last_file,
    })
}

#[tauri::command]
fn set_config(
    templates_dir: String,
    filters_dir: String,
    debounce_ms: u64,
    timeout_ms: u64,
    render_command: String,
    restore_last_file: Option<bool>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    if render_command.trim().is_empty() {
        return Err("renderCommand must be a non-empty shell command".into());
    }
    let mut s = state.lock().unwrap();
    let templates = PathBuf::from(&templates_dir);
    let filters = PathBuf::from(&filters_dir);

    s.templates_dir = templates;
    s.filters_dir = filters.clone();
    s.debounce_ms = debounce_ms;
    s.timeout_ms = timeout_ms;
    s.render_command = render_command.clone();
    s.restore_last_file = restore_last_file.unwrap_or(true);

    if let Some(ref config_path) = s.config_path {
        write_config_toml(
            config_path,
            debounce_ms,
            timeout_ms,
            restore_last_file.unwrap_or(true),
            &render_command,
            &templates_dir,
            &filters_dir,
        )?;
    }

    Ok(serde_json::json!({ "ok": true }))
}

// ─── filters ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_filters(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    let expand = |p: &str| -> PathBuf {
        if p.starts_with("~/") {
            home.join(&p[2..])
        } else {
            PathBuf::from(p)
        }
    };

    let raw_paths = extract_filter_paths(&s.render_command);
    let active: std::collections::HashSet<PathBuf> = raw_paths
        .iter()
        .map(|p| {
            let exp = expand(p);
            if exp.is_absolute() {
                exp
            } else {
                std::env::current_dir().unwrap_or_default().join(exp)
            }
        })
        .collect();

    let mut files: Vec<serde_json::Value> = vec![];
    if s.filters_dir.exists() {
        if let Ok(entries) = fs::read_dir(&s.filters_dir) {
            let filters_dir = s.filters_dir.clone();
            files = entries
                .flatten()
                .filter(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .ends_with(".lua")
                        && e.path().is_file()
                })
                .map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let abs = filters_dir.join(&name);
                    let enabled = active.contains(&abs);
                    serde_json::json!({
                        "name": name,
                        "path": abs.to_string_lossy(),
                        "enabled": enabled,
                    })
                })
                .collect();
        }
    }

    Ok(serde_json::json!({ "filters": files }))
}

#[tauri::command]
fn toggle_filters(
    enabled: Vec<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut s = state.lock().unwrap();
    let filters_dir = s.filters_dir.clone();
    let mut remaining = remove_filter_flags(&s.render_command, &filters_dir);

    for item in &enabled {
        let filename = if item.ends_with(".lua") {
            Path::new(item)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| item.clone())
        } else {
            format!(
                "{}.lua",
                Path::new(item)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| item.clone())
            )
        };
        let path_opt = filters_dir.join(&filename);
        remaining.push(format!("--lua-filter={}", path_opt.to_string_lossy()));
    }

    let new_cmd = shell_words::join(std::iter::once("pandoc").chain(remaining.iter().map(String::as_str)));
    s.render_command = new_cmd.clone();

    if let Some(ref config_path) = s.config_path.clone() {
        write_config_toml(
            config_path,
            s.debounce_ms,
            s.timeout_ms,
            true,
            &new_cmd,
            &s.templates_dir.to_string_lossy(),
            &s.filters_dir.to_string_lossy(),
        )?;
    }

    Ok(serde_json::json!({ "ok": true, "renderCommand": new_cmd }))
}

// ─── zotero ───────────────────────────────────────────────────────────────────

const ZOTERO_CAYW_URL: &str = "http://127.0.0.1:23119/better-bibtex/cayw";

#[tauri::command]
async fn zotero_cite() -> Result<serde_json::Value, String> {
    let url = format!("{}?format=pandoc&brackets=1", ZOTERO_CAYW_URL);
    let response = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("zotero returned {}", response.status()));
    }
    let citation = response.text().await.map_err(|e| e.to_string())?.trim().to_string();
    if citation.is_empty() {
        return Ok(serde_json::json!({ "empty": true }));
    }
    Ok(serde_json::json!({ "citation": citation }))
}

// ─── diagram proxy ────────────────────────────────────────────────────────────

const ALLOWED_PROXY_HOSTS: &[&str] = &["q.uiver.app", "freetikz.app", "homepages.inf.ed.ac.uk"];

#[tauri::command]
async fn diagram_proxy(url: String) -> Result<serde_json::Value, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL format".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    if !ALLOWED_PROXY_HOSTS.contains(&host) || parsed.scheme() != "https" {
        return Err("proxy host not allowed".into());
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?;
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

    // Premium TikZ overlay (ported verbatim from Express)
    let overlay = TIKZ_OVERLAY;
    if html.contains("</body>") {
        html = html.replacen("</body>", &format!("{}</body>", overlay), 1);
    } else {
        html.push_str(overlay);
    }

    Ok(serde_json::json!({ "html": html }))
}

const TIKZ_OVERLAY: &str = r#"<div id="pandoc-preview-export-overlay" style="position: fixed; top: 12px; right: 12px; z-index: 2147483647; background: linear-gradient(135deg, #1e1e2e 0%, #181825 100%); color: #cdd6f4; padding: 16px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: 'Outfit', 'Inter', sans-serif; display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(137, 180, 250, 0.2); width: 280px; backdrop-filter: blur(10px);">
  <div style="display: flex; align-items: center; gap: 8px;">
    <span style="background: #89b4fa; color: #11111b; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 999px; text-transform: uppercase;">Preview</span>
    <div style="font-size: 13px; font-weight: 700; color: #f5c2e7;">TikZ Integrator</div>
  </div>
  <button id="pandoc-preview-btn-export" style="background: linear-gradient(90deg, #89b4fa 0%, #b4befe 100%); color: #11111b; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 13px;">Insert into Document</button>
  <div id="pandoc-preview-status" style="font-size: 11px; color: #a6adc8;">Draw your diagram, click the export/LaTeX button inside this tool, then click "Insert" above.</div>
</div>
<script>
  document.getElementById('pandoc-preview-btn-export').addEventListener('click', () => {
    let code = '';
    for (const ta of Array.from(document.querySelectorAll('textarea'))) {
      if (ta.value.includes('\\begin{tikzcd}') || ta.value.includes('\\begin{tikzpicture}')) { code = ta.value; break; }
    }
    if (!code) {
      for (const el of Array.from(document.querySelectorAll('div, pre, code, p'))) {
        const text = el.textContent || '';
        if (text.includes('\\begin{tikzcd}') || text.includes('\\begin{tikzpicture}')) { code = text; break; }
      }
    }
    const tikzcdMatch = code.match(/\\begin\{tikzcd\}[\s\S]*?\\end\{tikzcd\}/);
    const tikzMatch = code.match(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/);
    const extracted = tikzcdMatch ? tikzcdMatch[0] : (tikzMatch ? tikzMatch[0] : code.trim());
    if (extracted && (extracted.includes('\\begin{') || extracted.includes('\\draw'))) {
      window.parent.postMessage({ type: 'diagram-export', code: extracted }, '*');
      document.getElementById('pandoc-preview-status').innerText = 'Diagram exported successfully!';
      document.getElementById('pandoc-preview-status').style.color = '#a6e3a1';
    } else {
      document.getElementById('pandoc-preview-status').innerText = 'Could not find TikZ/LaTeX code. Please trigger export inside the tool first.';
      document.getElementById('pandoc-preview-status').style.color = '#f38ba8';
    }
  });
</script>"#;

// ─── diagram tools ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_diagram_tools(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    serde_json::Value::Object(
        s.tool_state
            .iter()
            .map(|(id, entry)| (id.clone(), serde_json::Value::Bool(entry.installed)))
            .collect(),
    )
}

#[tauri::command]
fn create_diagram_file(
    kind: String,
    filename: String,
    document_path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let resolved_doc = if Path::new(&document_path).is_absolute() {
        PathBuf::from(&document_path)
    } else {
        resolve_inside(&workspace_root, &document_path)?
    };
    if s.is_temp_file || s.file.is_none() || s.file.as_ref() != Some(&resolved_doc) {
        return Err("save the document before adding figures".into());
    }
    let is_central = matches!(s.figures_storage_strategy, FiguresStorageStrategy::Central);
    let figures_dir = if is_central {
        figures_central_dir(&s)
    } else {
        s.file
            .as_ref()
            .and_then(|f| f.parent())
            .unwrap_or(Path::new("."))
            .join("figures")
    };
    let figure_path = normalize_path(&figures_dir.join(&filename));
    if !path_is_inside(&figures_dir, &figure_path) {
        return Err("figure path escapes figures directory".into());
    }
    if figure_path.exists() {
        return Err("figure already exists".into());
    }
    fs::create_dir_all(&figures_dir).map_err(|e| e.to_string())?;
    let template = starter_template_for_tool(&kind);
    fs::write(&figure_path, template).map_err(|e| e.to_string())?;

    if is_central {
        register_figure(&s, &filename, &figure_path, &kind);
    }

    let relative_path = if is_central {
        figure_path.to_string_lossy().into_owned()
    } else {
        format!("figures/{}", filename)
    };
    Ok(serde_json::json!({
        "ok": true,
        "absolutePath": figure_path.to_string_lossy(),
        "relativePath": relative_path,
    }))
}

#[tauri::command]
fn launch_diagram(
    absolute_path: String,
    kind: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let tool_type = kind.unwrap_or_else(|| {
        let ext = Path::new(&absolute_path)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default();
        tool_id_for_ext(&ext).to_string()
    });
    let entry = s
        .tool_state
        .get(&tool_type)
        .ok_or_else(|| format!("unknown tool: {}", tool_type))?;
    if !entry.installed {
        return Err(format!(
            "Desktop application for {} is not installed on this system",
            tool_type
        ));
    }
    let resolved = if Path::new(&absolute_path).is_absolute() {
        PathBuf::from(&absolute_path)
    } else if let Some(ref file) = s.file {
        file.parent()
            .unwrap_or(Path::new("."))
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

// ─── figures assets ───────────────────────────────────────────────────────────

#[tauri::command]
fn save_figure_asset(
    content_base64: String,
    document_path: String,
    filename: Option<String>,
    mime_type: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    if !mime_type.starts_with("image/") {
        return Err("mimeType must be an image type".into());
    }
    let s = state.lock().unwrap();
    let workspace_root = s.workspace_root();
    let target_doc = if Path::new(&document_path).is_absolute() {
        PathBuf::from(&document_path)
    } else {
        resolve_inside(&workspace_root, &document_path)?
    };
    if s.file.is_none() || s.is_temp_file || s.file.as_ref() != Some(&target_doc) {
        return Err("save the document before adding figures".into());
    }
    let is_central = matches!(s.figures_storage_strategy, FiguresStorageStrategy::Central);
    let figures_dir = if is_central {
        figures_central_dir(&s)
    } else {
        target_doc
            .parent()
            .unwrap_or(Path::new("."))
            .join("figures")
    };
    let figure_name = filename
        .as_deref()
        .filter(|n| !n.is_empty())
        .map(|n| sanitize_figure_filename(n, &mime_type))
        .unwrap_or_else(|| {
            format!("figure-{}{}", Uuid::new_v4(), image_extension(&mime_type))
        });
    let figure_path = normalize_path(&figures_dir.join(&figure_name));
    if !path_is_inside(&figures_dir, &figure_path) {
        return Err("figure path escapes figures directory".into());
    }
    if figure_path.exists() {
        return Err("figure already exists".into());
    }
    fs::create_dir_all(&figures_dir).map_err(|e| e.to_string())?;
    let bytes = B64.decode(&content_base64).map_err(|e| e.to_string())?;
    fs::write(&figure_path, &bytes).map_err(|e| e.to_string())?;

    if is_central {
        register_figure(&s, &figure_name, &figure_path, "clipboard");
    }

    let relative_path = if is_central {
        figure_path.to_string_lossy().into_owned()
    } else {
        format!("figures/{}", figure_name)
    };
    let markdown = if is_central {
        format!("![]({})", relative_path)
    } else {
        format!("![](./{relative_path})")
    };
    Ok(serde_json::json!({
        "ok": true,
        "path": figure_path.to_string_lossy(),
        "relativePath": relative_path,
        "markdown": markdown,
    }))
}

#[tauri::command]
fn figures_registry(state: State<'_, Mutex<AppState>>) -> Result<serde_json::Value, String> {
    let s = state.lock().unwrap();
    let central_dir = figures_central_dir(&s);
    let registry = load_figures_registry(&central_dir);
    Ok(serde_json::to_value(registry).unwrap())
}

// ─── plugins ──────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_plugins(state: State<'_, Mutex<AppState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
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
async fn run_plugin(
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
        .collect();
    let output_path = plugin
        .output
        .as_deref()
        .map(|o| interpolate_plugin_arg(o, &file_path));
    let plugin_timeout = plugin.timeout_ms.unwrap_or(timeout_ms);
    let cwd = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();

    let output = tokio::time::timeout(
        std::time::Duration::from_millis(plugin_timeout),
        tokio::process::Command::new(&plugin.command)
            .args(&args)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
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

// ─── quick-open-spawn (rofi/dmenu) ───────────────────────────────────────────

#[tauri::command]
async fn quick_open_spawn(
    state: State<'_, Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let (workspace_root, launcher_cmd) = {
        let s = state.lock().unwrap();
        (s.workspace_root(), s.launcher_command.clone())
    };

    let cmd = if let Some(c) = launcher_cmd {
        c
    } else {
        let has_rofi = Path::new("/usr/bin/rofi").exists() || Path::new("/bin/rofi").exists();
        let has_dmenu = Path::new("/usr/bin/dmenu").exists() || Path::new("/bin/dmenu").exists();
        let has_fd = Path::new("/usr/bin/fd").exists() || Path::new("/bin/fd").exists();
        let finder = if has_fd { "fd -e md -t f" } else { "find . -name '*.md'" };
        if has_rofi {
            format!("{} | rofi -dmenu -i -p \"Quick Open:\"", finder)
        } else if has_dmenu {
            format!("{} | dmenu -i -p \"Quick Open:\"", finder)
        } else {
            format!("{} | dmenu -i -p \"Quick Open:\"", finder)
        }
    };

    let output = tokio::process::Command::new("zsh")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&workspace_root)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    // Exit code 130 = user dismissed; 1 = nothing selected
    let code = output.status.code().unwrap_or(0);
    if code == 130 || code == 1 {
        return Ok(serde_json::json!({ "ok": false, "cancelled": true }));
    }

    let trimmed = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if trimmed.is_empty() {
        return Ok(serde_json::json!({ "ok": false, "cancelled": true }));
    }

    let target_path = resolve_inside(&workspace_root, &trimmed)?;
    if !target_path.exists() || !target_path.is_file() {
        return Ok(serde_json::json!({
            "ok": false,
            "error": format!("Selected path \"{}\" does not exist or is not a file.", trimmed),
        }));
    }
    if !is_markdown_file(&target_path) {
        return Ok(serde_json::json!({
            "ok": false,
            "error": format!("Selected path \"{}\" is not a markdown file.", trimmed),
        }));
    }

    let content = fs::read_to_string(&target_path).map_err(|e| e.to_string())?;
    let relative_path = to_client_path(&workspace_root, &target_path);

    {
        let mut s = state.lock().unwrap();
        if let Some(fp) = get_file_fingerprint(&target_path) {
            s.file_fingerprints.insert(target_path.to_string_lossy().into_owned(), fp);
        }
        track_recent(&mut s.recent_files, &target_path);
        s.file = Some(target_path.clone());
        s.is_temp_file = false;
        save_session_state(&target_path, false);
    }

    Ok(serde_json::json!({
        "ok": true,
        "path": relative_path,
        "absolutePath": target_path.to_string_lossy(),
        "content": content,
    }))
}

// ─── app setup ────────────────────────────────────────────────────────────────

fn default_templates_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pandoc/templates")
}

fn default_filters_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pandoc/filters")
}

const DEFAULT_RENDER_COMMAND: &str =
    "pandoc -f markdown+tex_math_dollars+citations --standalone --to=html5";

fn load_config_from_toml(config_path: &Path) -> TomlConfig {
    if !config_path.exists() {
        return TomlConfig::default();
    }
    let content = fs::read_to_string(config_path).unwrap_or_default();
    toml_edit::de::from_str::<TomlConfig>(&content).unwrap_or_default()
}

fn discover_config_path() -> Option<PathBuf> {
    // XDG_CONFIG_HOME / pandoc-preview / config.toml
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".config")
        });
    let path = base.join("pandoc-preview/config.toml");
    Some(path)
}

fn build_initial_state() -> AppState {
    let config_path = discover_config_path();
    let toml = config_path
        .as_deref()
        .map(load_config_from_toml)
        .unwrap_or_default();

    let render = toml.render.unwrap_or_default();
    let pandoc = toml.pandoc.unwrap_or_default();

    let render_command = pandoc
        .render_command
        .unwrap_or_else(|| DEFAULT_RENDER_COMMAND.to_string());
    let templates_dir = pandoc
        .templates_dir
        .map(PathBuf::from)
        .unwrap_or_else(default_templates_dir);
    let filters_dir = pandoc
        .filters_dir
        .map(PathBuf::from)
        .unwrap_or_else(default_filters_dir);
    let debounce_ms = render.debounce_ms.unwrap_or(750);
    let timeout_ms = render.timeout_ms.unwrap_or(30_000);
    let restore_last_file = render.restore_last_file.unwrap_or(true);

    // Restore last session
    let (last_file, is_temp_file) = try_restore_last_file(restore_last_file);

    // Load plugins from src/server/plugins/ — Tauri will embed them as resources
    let plugin_dir = {
        // During dev: relative to binary; we try a few locations
        let candidates = [
            PathBuf::from("src/server/plugins"),
            std::env::current_exe()
                .unwrap_or_default()
                .parent()
                .unwrap_or(Path::new("."))
                .join("../server/plugins"),
        ];
        candidates
            .iter()
            .find(|p| p.exists())
            .cloned()
            .unwrap_or_else(|| PathBuf::from("src/server/plugins"))
    };
    let plugins = load_bundled_plugins(&plugin_dir);
    let tool_state = probe_tool_state();

    AppState {
        render_command,
        timeout_ms,
        file: last_file,
        file_content: None,
        workspace_root: None,
        is_temp_file,
        config_path,
        templates_dir,
        filters_dir,
        debounce_ms,
        launcher_command: None,
        recovered_from_backup: false,
        restore_last_file,
        figures_storage_strategy: FiguresStorageStrategy::Relative,
        figures_central_directory: None,
        plugins,
        recent_files: vec![],
        file_fingerprints: HashMap::new(),
        tool_state,
    }
}

fn try_restore_last_file(restore: bool) -> (Option<PathBuf>, bool) {
    if !restore {
        return (None, false);
    }
    let path = state_file_path();
    if !path.exists() {
        return (None, false);
    }
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return (None, false),
    };
    let v: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return (None, false),
    };
    let last_file = v["last_file"].as_str().map(PathBuf::from);
    let is_temp = v["is_temp_file"].as_bool().unwrap_or(false);
    if let Some(ref f) = last_file {
        if !f.exists() {
            return (None, false);
        }
    }
    (last_file, is_temp)
}

// ─── entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_state = build_initial_state();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(Mutex::new(initial_state))
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            render,
            save,
            backup,
            browse,
            list_files,
            quick_open,
            quick_open_spawn,
            file_content,
            file_exists,
            new_file,
            open_file_external,
            pandoc_assets,
            get_config,
            set_config,
            list_filters,
            toggle_filters,
            zotero_cite,
            diagram_proxy,
            get_diagram_tools,
            create_diagram_file,
            launch_diagram,
            save_figure_asset,
            figures_registry,
            list_plugins,
            run_plugin,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ─── tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ── normalize_path ────────────────────────────────────────────────────────

    #[test]
    fn normalize_path_strips_dots() {
        assert_eq!(
            normalize_path(Path::new("/foo/./bar/./baz")),
            PathBuf::from("/foo/bar/baz")
        );
    }

    #[test]
    fn normalize_path_resolves_parent_dirs() {
        assert_eq!(
            normalize_path(Path::new("/foo/bar/../baz")),
            PathBuf::from("/foo/baz")
        );
    }

    #[test]
    fn normalize_path_noop_clean_path() {
        assert_eq!(
            normalize_path(Path::new("/foo/bar/baz")),
            PathBuf::from("/foo/bar/baz")
        );
    }

    // ── path_is_inside ────────────────────────────────────────────────────────

    #[test]
    fn path_is_inside_direct_child() {
        assert!(path_is_inside(Path::new("/ws"), Path::new("/ws/file.md")));
    }

    #[test]
    fn path_is_inside_deep_child() {
        assert!(path_is_inside(
            Path::new("/ws"),
            Path::new("/ws/a/b/c/file.md")
        ));
    }

    #[test]
    fn path_is_inside_self() {
        assert!(path_is_inside(Path::new("/ws"), Path::new("/ws")));
    }

    #[test]
    fn path_is_outside_rejected() {
        assert!(!path_is_inside(
            Path::new("/ws"),
            Path::new("/etc/passwd")
        ));
    }

    #[test]
    fn path_is_outside_parent_dir_escape_rejected() {
        assert!(!path_is_inside(
            Path::new("/ws/sub"),
            Path::new("/ws/../outside")
        ));
    }

    // ── resolve_inside ────────────────────────────────────────────────────────

    #[test]
    fn resolve_inside_relative_path() {
        let root = Path::new("/ws");
        assert_eq!(
            resolve_inside(root, "sub/file.md").unwrap(),
            PathBuf::from("/ws/sub/file.md")
        );
    }

    #[test]
    fn resolve_inside_empty_path_returns_root() {
        assert_eq!(
            resolve_inside(Path::new("/ws"), "").unwrap(),
            PathBuf::from("/ws")
        );
    }

    #[test]
    fn resolve_inside_rejects_parent_dir_escape() {
        assert!(resolve_inside(Path::new("/ws/sub"), "../outside").is_err());
    }

    // ── write_file_atomic ─────────────────────────────────────────────────────

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

        let tmp_count = fs::read_dir(dir.path())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".tmp-")
            })
            .count();
        assert_eq!(tmp_count, 0);
    }

    // ── config TOML round-trip ────────────────────────────────────────────────

    #[test]
    fn config_toml_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        write_config_toml(
            &path, 500, 20000, true,
            "pandoc --standalone -t html5",
            "/home/user/.pandoc/templates",
            "/home/user/.pandoc/filters",
        )
        .unwrap();

        let loaded = load_config_from_toml(&path);
        let render = loaded.render.unwrap();
        let pandoc = loaded.pandoc.unwrap();

        assert_eq!(render.debounce_ms, Some(500));
        assert_eq!(render.timeout_ms, Some(20000));
        assert_eq!(render.restore_last_file, Some(true));
        assert_eq!(
            pandoc.render_command.unwrap(),
            "pandoc --standalone -t html5"
        );
        assert_eq!(
            pandoc.templates_dir.unwrap(),
            "/home/user/.pandoc/templates"
        );
        assert_eq!(
            pandoc.filters_dir.unwrap(),
            "/home/user/.pandoc/filters"
        );
    }

    // ── extract_filter_paths ──────────────────────────────────────────────────

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

    // ── remove_filter_flags ───────────────────────────────────────────────────

    #[test]
    fn remove_filter_flags_drops_filters_inside_filters_dir() {
        let dir = tempfile::tempdir().unwrap();
        let f1 = dir.path().join("a.lua");
        let f2 = dir.path().join("b.lua");
        fs::write(&f1, "").unwrap();
        fs::write(&f2, "").unwrap();

        let cmd = format!(
            "pandoc --lua-filter={} --standalone --lua-filter={}",
            f1.display(),
            f2.display()
        );
        let remaining = remove_filter_flags(&cmd, dir.path());
        // Only --standalone should remain (plus implicit pandoc)
        assert_eq!(remaining, vec!["--standalone"]);
    }

    #[test]
    fn remove_filter_flags_preserves_filters_outside_filters_dir() {
        let dir = tempfile::tempdir().unwrap();
        let cmd = "pandoc --lua-filter=/outside/f.lua --standalone";
        let remaining = remove_filter_flags(cmd, dir.path());
        assert_eq!(
            remaining,
            vec!["--lua-filter=/outside/f.lua", "--standalone"]
        );
    }

    // ── is_text_like_file / is_markdown_file ──────────────────────────────────

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

    // ── sanitize_figure_filename ──────────────────────────────────────────────

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

    // ── interpolate_plugin_arg ────────────────────────────────────────────────

    #[test]
    fn interpolate_plugin_arg_substitutes_file() {
        let result = interpolate_plugin_arg("${FILE}", Path::new("/ws/doc.md"));
        assert_eq!(result, "/ws/doc.md");
    }

    #[test]
    fn interpolate_plugin_arg_substitutes_stem() {
        let result = interpolate_plugin_arg("${FILE_STEM}", Path::new("/ws/doc.md"));
        assert_eq!(result, "doc");
    }

    #[test]
    fn interpolate_plugin_arg_substitutes_dir() {
        let result = interpolate_plugin_arg("${FILE_DIR}", Path::new("/ws/doc.md"));
        assert_eq!(result, "/ws");
    }
}
