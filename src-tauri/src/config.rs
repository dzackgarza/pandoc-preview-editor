use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::state::{AppState, FigureEntry, FiguresRegistry, FiguresStorageStrategy, ToolEntry};
use sha2::{Digest, Sha256};
use uuid::Uuid;

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

pub fn get_backup_path(document_path: &Path) -> PathBuf {
    let canonical = document_path
        .canonicalize()
        .unwrap_or_else(|_| document_path.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let hash = hex::encode(hasher.finalize());
    backup_dir().join(format!("{}.md", hash))
}

pub fn save_session_state(last_file: &Path, is_temp_file: bool) {
    let dir = xdg_state_dir();
    let _ = fs::create_dir_all(&dir);
    let state = serde_json::json!({
        "last_file": last_file.to_string_lossy(),
        "is_temp_file": is_temp_file,
    });
    let _ = fs::write(state_file_path(), serde_json::to_string_pretty(&state).unwrap());
}

pub fn load_figures_registry(dir: &Path) -> FiguresRegistry {
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

pub fn figures_central_dir(state: &AppState) -> PathBuf {
    state
        .figures_central_directory
        .clone()
        .unwrap_or_else(default_figures_central_dir)
}

pub fn register_figure(state: &AppState, name: &str, absolute_path: &Path, kind: &str) {
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
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{}", secs)
}

#[derive(Debug, serde::Deserialize, Default)]
pub struct TomlConfig {
    pub render: Option<TomlRenderSection>,
    pub pandoc: Option<TomlPandocSection>,
}

#[derive(Debug, serde::Deserialize, Default)]
pub struct TomlRenderSection {
    pub debounce_ms: Option<u64>,
    pub timeout_ms: Option<u64>,
    pub restore_last_file: Option<bool>,
}

#[derive(Debug, serde::Deserialize, Default)]
pub struct TomlPandocSection {
    pub render_command: Option<String>,
    pub templates_dir: Option<String>,
    pub filters_dir: Option<String>,
}

pub fn write_config_toml(
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

pub fn load_config_from_toml(config_path: &Path) -> TomlConfig {
    if !config_path.exists() {
        return TomlConfig::default();
    }
    let content = fs::read_to_string(config_path).unwrap_or_default();
    toml_edit::de::from_str::<TomlConfig>(&content).unwrap_or_default()
}

pub fn discover_config_path() -> Option<PathBuf> {
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

pub fn default_templates_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pandoc/templates")
}

pub fn default_filters_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pandoc/filters")
}

pub const DEFAULT_RENDER_COMMAND: &str =
    "pandoc -f markdown+tex_math_dollars+citations --standalone --to=html5";

pub fn build_initial_state() -> AppState {
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

    let (last_file, is_temp_file) = try_restore_last_file(restore_last_file);

    let plugin_dir = {
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
    let tool_state = crate::state::probe_tool_state();

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
    }
}

pub fn load_bundled_plugins(plugin_dir: &Path) -> Vec<crate::state::PluginManifest> {
    if !plugin_dir.exists() {
        return vec![];
    }
    let mut manifests = vec![];
    if let Ok(entries) = std::fs::read_dir(plugin_dir) {
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
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(manifest) = toml_edit::de::from_str::<crate::state::PluginManifest>(&content) {
                    manifests.push(manifest);
                }
            }
        }
    }
    manifests
}
