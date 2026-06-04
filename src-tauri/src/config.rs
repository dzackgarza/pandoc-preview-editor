use crate::state::AppState;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

fn xdg_state_dir() -> PathBuf {
    let base = std::env::var("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .expect("HOME must be set")
                .join(".local/state")
        });
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
    let _ = fs::write(
        state_file_path(),
        serde_json::to_string_pretty(&state).unwrap(),
    );
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

pub fn load_config_from_toml(config_path: &Path) -> Result<TomlConfig, String> {
    if !config_path.exists() {
        return Ok(TomlConfig::default());
    }
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("failed to read config {}: {}", config_path.display(), e))?;
    toml_edit::de::from_str::<TomlConfig>(&content)
        .map_err(|e| format!("failed to parse config {}: {}", config_path.display(), e))
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

pub fn build_initial_state() -> Result<AppState, String> {
    let config_path = discover_config_path();
    build_initial_state_from_config_path(config_path.as_deref())
}

pub fn build_initial_state_from_config_path(
    config_path: Option<&Path>,
) -> Result<AppState, String> {
    let config_path_buf = config_path.map(Path::to_path_buf);
    let config_exists = config_path.map(Path::exists).unwrap_or(false);
    let toml = match config_path {
        Some(path) => load_config_from_toml(path)?,
        None => TomlConfig::default(),
    };

    let render = require_section(toml.render, config_exists, "[render]")?;
    let pandoc = require_section(toml.pandoc, config_exists, "[pandoc]")?;

    let render_command = require_or_default(
        pandoc.render_command,
        config_exists,
        "pandoc-preview config is missing pandoc.render_command",
        || DEFAULT_RENDER_COMMAND.to_string(),
    )?;
    let parsed_flags = crate::command_flags::parse_render_command(&render_command);
    let templates_dir = PathBuf::from(require_or_default(
        pandoc.templates_dir,
        config_exists,
        "pandoc-preview config is missing pandoc.templates_dir",
        || default_templates_dir().to_string_lossy().into_owned(),
    )?);
    let filters_dir = PathBuf::from(require_or_default(
        pandoc.filters_dir,
        config_exists,
        "pandoc-preview config is missing pandoc.filters_dir",
        || default_filters_dir().to_string_lossy().into_owned(),
    )?);
    let debounce_ms = require_or_default(
        render.debounce_ms,
        config_exists,
        "pandoc-preview config is missing render.debounce_ms",
        || 750,
    )?;
    let timeout_ms = require_or_default(
        render.timeout_ms,
        config_exists,
        "pandoc-preview config is missing render.timeout_ms",
        || 30_000,
    )?;
    let restore_last_file = require_or_default(
        render.restore_last_file,
        config_exists,
        "pandoc-preview config is missing render.restore_last_file",
        || true,
    )?;

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

    Ok(AppState {
        render_command,
        parsed_flags,
        timeout_ms,
        file: last_file,
        file_content: None,
        workspace_root: None,
        is_temp_file,
        config_path: config_path_buf,
        templates_dir,
        filters_dir,
        debounce_ms,
        launcher_command: None,
        recovered_from_backup: false,
        restore_last_file,
        plugins,
        recent_files: vec![],
        file_fingerprints: HashMap::new(),
        tool_state,
    })
}

fn require_section<T>(
    value: Option<T>,
    config_exists: bool,
    section_name: &str,
) -> Result<T, String>
where
    T: Default,
{
    if config_exists {
        value.ok_or_else(|| {
            format!("pandoc-preview config is missing required {section_name} section")
        })
    } else {
        Ok(value.unwrap_or_default())
    }
}

fn require_or_default<T, F>(
    value: Option<T>,
    config_exists: bool,
    missing_message: &'static str,
    default: F,
) -> Result<T, String>
where
    F: FnOnce() -> T,
{
    if config_exists {
        value.ok_or_else(|| missing_message.to_string())
    } else {
        Ok(value.unwrap_or_else(default))
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

pub fn load_bundled_plugins(plugin_dir: &Path) -> Vec<crate::state::PluginManifest> {
    if !plugin_dir.exists() {
        return vec![];
    }
    let mut manifests = vec![];
    if let Ok(entries) = std::fs::read_dir(plugin_dir) {
        let mut names: Vec<_> = entries
            .flatten()
            .filter(|e| e.path().extension().map(|x| x == "toml").unwrap_or(false))
            .map(|e| e.path())
            .collect();
        names.sort();
        for path in names {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(manifest) =
                    toml_edit::de::from_str::<crate::state::PluginManifest>(&content)
                {
                    manifests.push(manifest);
                }
            }
        }
    }
    manifests
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_config_file_builds_default_initial_state() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");

        let state = build_initial_state_from_config_path(Some(&config_path)).unwrap();

        assert_eq!(state.config_path, Some(config_path));
        assert_eq!(state.render_command, DEFAULT_RENDER_COMMAND);
        assert_eq!(state.debounce_ms, 750);
        assert_eq!(state.timeout_ms, 30_000);
        assert!(state.restore_last_file);
    }

    #[test]
    fn existing_config_missing_render_section_fails_loudly() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
[pandoc]
render_command = "pandoc -t html5"
templates_dir = "/tmp/templates"
filters_dir = "/tmp/filters"
"#,
        )
        .expect("test config must be writable");

        let error = build_initial_state_from_config_path(Some(&config_path)).unwrap_err();

        assert!(error.contains("missing required [render] section"));
    }

    #[test]
    fn existing_config_missing_render_command_fails_loudly() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
[render]
debounce_ms = 100
timeout_ms = 20000
restore_last_file = true

[pandoc]
templates_dir = "/tmp/templates"
filters_dir = "/tmp/filters"
"#,
        )
        .expect("test config must be writable");

        let error = build_initial_state_from_config_path(Some(&config_path)).unwrap_err();

        assert!(error.contains("pandoc.render_command"));
    }

    #[test]
    fn malformed_existing_config_fails_loudly() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        fs::write(&config_path, "[render\n").expect("test config must be writable");

        let error = build_initial_state_from_config_path(Some(&config_path)).unwrap_err();

        assert!(error.contains("failed to parse config"));
        assert!(error.contains(&config_path.display().to_string()));
    }

    #[test]
    fn complete_existing_config_builds_configured_initial_state() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        fs::write(
            &config_path,
            r#"
[render]
debounce_ms = 125
timeout_ms = 45000
restore_last_file = false

[pandoc]
render_command = "pandoc --standalone -t html5"
templates_dir = "/tmp/templates"
filters_dir = "/tmp/filters"
"#,
        )
        .expect("test config must be writable");

        let state = build_initial_state_from_config_path(Some(&config_path)).unwrap();

        assert_eq!(state.render_command, "pandoc --standalone -t html5");
        assert_eq!(state.debounce_ms, 125);
        assert_eq!(state.timeout_ms, 45_000);
        assert!(!state.restore_last_file);
        assert_eq!(state.templates_dir, PathBuf::from("/tmp/templates"));
        assert_eq!(state.filters_dir, PathBuf::from("/tmp/filters"));
    }
}
