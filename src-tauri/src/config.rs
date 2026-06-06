use crate::command_flags::ParsedCommandFlags;
use crate::state::AppState;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

fn xdg_state_dir() -> PathBuf {
    let base = std::env::var("XDG_STATE_HOME")
        .map(PathBuf::from)
        .ok()
        .or_else(|| {
            dirs::home_dir().map(|h| h.join(".local/state"))
        })
        .expect("Failed to determine state directory: XDG_STATE_HOME is not set and HOME is unknown or inaccessible.");
    base.join("pandoc-preview")
}

fn backup_dir() -> PathBuf {
    xdg_state_dir().join("backups")
}

fn state_file_path() -> PathBuf {
    xdg_state_dir().join("state.json")
}

pub fn get_backup_path(document_path: &Path) -> Result<PathBuf, String> {
    let canonical = document_path.canonicalize().map_err(|e| {
        format!(
            "failed to canonicalize document path {}: {}",
            document_path.display(),
            e
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let hash = hex::encode(hasher.finalize());
    Ok(backup_dir().join(format!("{}.md", hash)))
}

pub fn save_session_state(last_file: &Path, is_temp_file: bool) {
    let dir = xdg_state_dir();
    fs::create_dir_all(&dir)
        .unwrap_or_else(|e| panic!("Failed to create state directory {}: {}", dir.display(), e));
    let state = serde_json::json!({
        "last_file": last_file.to_string_lossy(),
        "is_temp_file": is_temp_file,
    });
    let state_file = state_file_path();
    fs::write(&state_file, serde_json::to_string_pretty(&state).unwrap()).unwrap_or_else(|e| {
        panic!(
            "Failed to write session state to {}: {}",
            state_file.display(),
            e
        )
    });
}

#[derive(Debug, serde::Deserialize)]
pub struct TomlConfig {
    pub render: TomlRenderSection,
    pub pandoc: TomlPandocSection,
}

#[derive(Debug, serde::Deserialize)]
pub struct TomlRenderSection {
    pub debounce_ms: u64,
    pub timeout_ms: u64,
    pub restore_last_file: bool,
}

#[derive(Debug, serde::Deserialize)]
pub struct TomlPandocSection {
    pub render_command: String,
    pub templates_dir: String,
    pub filters_dir: String,
    pub figures_dir: String,
}

pub fn write_config_toml(
    path: &Path,
    debounce_ms: u64,
    timeout_ms: u64,
    restore_last_file: bool,
    render_command: &str,
    templates_dir: &str,
    filters_dir: &str,
    figures_dir: &str,
) -> Result<(), String> {
    let mut doc = toml_edit::DocumentMut::new();
    doc["render"]["debounce_ms"] = toml_edit::value(debounce_ms as i64);
    doc["render"]["timeout_ms"] = toml_edit::value(timeout_ms as i64);
    doc["render"]["restore_last_file"] = toml_edit::value(restore_last_file);
    doc["pandoc"]["render_command"] = toml_edit::value(render_command);
    doc["pandoc"]["templates_dir"] = toml_edit::value(templates_dir);
    doc["pandoc"]["filters_dir"] = toml_edit::value(filters_dir);
    doc["pandoc"]["figures_dir"] = toml_edit::value(figures_dir);
    fs::write(path, doc.to_string()).map_err(|e| e.to_string())
}

pub fn load_config_from_toml(config_path: &Path) -> Result<TomlConfig, String> {
    if !config_path.exists() {
        return Err(format!(
            "pandoc-preview config does not exist: {}. Run `just setup` to create it.",
            config_path.display()
        ));
    }
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("failed to read config {}: {}", config_path.display(), e))?;
    toml_edit::de::from_str::<TomlConfig>(&content)
        .map_err(|e| format!("failed to parse config {}: {}", config_path.display(), e))
}

pub fn expand_config_path(raw_path: &str) -> Result<PathBuf, String> {
    if raw_path.trim().is_empty() {
        return Err("config path must not be empty".into());
    }
    if raw_path != raw_path.trim() {
        return Err(format!(
            "config path must not contain leading or trailing whitespace: {raw_path:?}"
        ));
    }
    if raw_path == "~" {
        return dirs::home_dir()
            .ok_or_else(|| "HOME must be set to expand config path `~`".to_string());
    }
    if let Some(rest) = raw_path.strip_prefix("~/") {
        return dirs::home_dir()
            .map(|home| home.join(rest))
            .ok_or_else(|| format!("HOME must be set to expand config path `{raw_path}`"));
    }
    if raw_path == "$HOME" || raw_path == "${HOME}" {
        return dirs::home_dir()
            .ok_or_else(|| format!("HOME must be set to expand config path `{raw_path}`"));
    }
    if let Some(rest) = raw_path.strip_prefix("$HOME/") {
        return dirs::home_dir()
            .map(|home| home.join(rest))
            .ok_or_else(|| format!("HOME must be set to expand config path `{raw_path}`"));
    }
    if let Some(rest) = raw_path.strip_prefix("${HOME}/") {
        return dirs::home_dir()
            .map(|home| home.join(rest))
            .ok_or_else(|| format!("HOME must be set to expand config path `{raw_path}`"));
    }
    if raw_path.starts_with('~') {
        return Err(format!(
            "unsupported home-relative config path `{raw_path}`; use `~/...`"
        ));
    }
    if raw_path.starts_with('$') {
        return Err(format!(
            "unsupported environment-relative config path `{raw_path}`; only $HOME and ${{HOME}} are accepted"
        ));
    }
    Ok(PathBuf::from(raw_path))
}

pub fn validate_existing_dir(label: &str, path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::metadata(path).map_err(|e| {
        format!(
            "configured Pandoc {label} does not exist: {}: {e}",
            path.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "configured Pandoc {label} is not a directory: {}",
            path.display()
        ));
    }
    fs::canonicalize(path).map_err(|e| {
        format!(
            "failed to canonicalize configured Pandoc {label} {}: {e}",
            path.display()
        )
    })
}

fn validate_asset_file(
    kind: &str,
    raw_path: &str,
    base_dir: &Path,
    base_label: &str,
) -> Result<(), String> {
    if raw_path == "~" || raw_path.starts_with("~/") {
        return Err(format!(
            "configured Pandoc {kind} uses `{raw_path}`, but the renderer shell does not expand `~` inside flag values; use $HOME/... or an absolute path"
        ));
    }
    let expanded = expand_config_path(raw_path)?;
    let candidate = if expanded.is_absolute() {
        expanded
    } else {
        base_dir.join(expanded)
    };
    let metadata = fs::metadata(&candidate).map_err(|e| {
        format!(
            "missing configured Pandoc {kind}: {}: {e}",
            candidate.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "configured Pandoc {kind} is not a file: {}",
            candidate.display()
        ));
    }
    let canonical = fs::canonicalize(&candidate).map_err(|e| {
        format!(
            "failed to canonicalize configured Pandoc {kind} {}: {e}",
            candidate.display()
        )
    })?;
    if !canonical.starts_with(base_dir) {
        return Err(format!(
            "configured Pandoc {kind} must resolve inside {base_label}: {} is outside {}",
            canonical.display(),
            base_dir.display()
        ));
    }
    Ok(())
}

pub fn validate_render_assets(
    parsed_flags: &ParsedCommandFlags,
    templates_dir: &Path,
    filters_dir: &Path,
    figures_dir: &Path,
) -> Result<(), String> {
    let canonical_templates_dir = validate_existing_dir("templates_dir", templates_dir)?;
    let canonical_filters_dir = validate_existing_dir("filters_dir", filters_dir)?;
    validate_existing_dir("figures_dir", figures_dir)?;

    if let Some(template) = &parsed_flags.template {
        validate_asset_file(
            "template",
            template,
            &canonical_templates_dir,
            "templates_dir",
        )?;
    }
    for filter in &parsed_flags.filters {
        validate_asset_file(
            &filter.flag,
            &filter.path,
            &canonical_filters_dir,
            "filters_dir",
        )?;
    }

    Ok(())
}

pub fn discover_config_path() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .ok()
        .or_else(|| {
            dirs::home_dir().map(|h| h.join(".config"))
        })
        .expect("Failed to determine config directory: XDG_CONFIG_HOME is not set and HOME is unknown or inaccessible.");
    base.join("pandoc-preview/config.toml")
}

pub fn build_initial_state() -> Result<AppState, String> {
    let config_path = discover_config_path();
    build_initial_state_from_config_path(&config_path)
}

pub fn build_initial_state_from_config_path(config_path: &Path) -> Result<AppState, String> {
    let toml = load_config_from_toml(config_path)?;
    let render = toml.render;
    let pandoc = toml.pandoc;

    if pandoc.render_command.trim().is_empty() {
        return Err("pandoc-preview config render_command must not be empty".into());
    }

    let render_command = pandoc.render_command;
    let parsed_flags = crate::command_flags::parse_render_command(&render_command)?;
    let templates_dir = expand_config_path(&pandoc.templates_dir)?;
    let filters_dir = expand_config_path(&pandoc.filters_dir)?;

    let figures_dir = expand_config_path(&pandoc.figures_dir)?;
    validate_render_assets(&parsed_flags, &templates_dir, &filters_dir, &figures_dir)?;

    let debounce_ms = render.debounce_ms;
    let timeout_ms = render.timeout_ms;
    let restore_last_file = render.restore_last_file;

    let (last_file, is_temp_file) = try_restore_last_file(restore_last_file)?;

    let plugin_dir = {
        let candidates = [
            PathBuf::from("src/server/plugins"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/server/plugins"),
            std::env::current_exe()
                .map_err(|e| format!("failed to resolve current executable: {e}"))?
                .parent()
                .ok_or("current executable has no parent directory")?
                .join("../server/plugins"),
        ];
        candidates
            .iter()
            .find(|p| p.exists())
            .cloned()
            .ok_or("bundled plugin directory not found")?
    };
    let plugins = load_bundled_plugins(&plugin_dir)?;
    let tool_state = crate::state::probe_tool_state();

    Ok(AppState {
        render_command,
        parsed_flags,
        timeout_ms,
        file: last_file,
        file_content: None,
        workspace_root: None,
        is_temp_file,
        config_path: Some(config_path.to_path_buf()),
        templates_dir,
        filters_dir,
        figures_dir,
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

fn try_restore_last_file(restore: bool) -> Result<(Option<PathBuf>, bool), String> {
    if !restore {
        return Ok((None, false));
    }
    let path = state_file_path();
    if !path.exists() {
        return Ok((None, false));
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read session state {}: {e}", path.display()))?;
    let v: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("failed to parse session state {}: {e}", path.display()))?;
    let last_file = v
        .get("last_file")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from);
    let is_temp = v
        .get("is_temp_file")
        .and_then(serde_json::Value::as_bool)
        .ok_or_else(|| format!("session state {} is missing is_temp_file", path.display()))?;
    if let Some(ref f) = last_file {
        if !f.exists() {
            return Err(format!(
                "session state {} references missing file {}",
                path.display(),
                f.display()
            ));
        }
    }
    Ok((last_file, is_temp))
}

pub fn load_bundled_plugins(
    plugin_dir: &Path,
) -> Result<Vec<crate::state::PluginManifest>, String> {
    if !plugin_dir.exists() {
        return Err(format!(
            "bundled plugin directory does not exist: {}",
            plugin_dir.display()
        ));
    }
    let mut manifests = vec![];
    let mut names = vec![];
    for entry in std::fs::read_dir(plugin_dir).map_err(|e| {
        format!(
            "failed to read plugin directory {}: {e}",
            plugin_dir.display()
        )
    })? {
        let entry = entry.map_err(|e| format!("failed to read plugin directory entry: {e}"))?;
        let path = entry.path();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext == "toml" {
                names.push(path);
            }
        }
    }
    names.sort();
    for path in names {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("failed to read plugin manifest {}: {e}", path.display()))?;
        let manifest = toml_edit::de::from_str::<crate::state::PluginManifest>(&content)
            .map_err(|e| format!("failed to parse plugin manifest {}: {e}", path.display()))?;
        manifests.push(manifest);
    }
    Ok(manifests)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_config_file_fails_loudly() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");

        let error = build_initial_state_from_config_path(&config_path).unwrap_err();

        assert!(error.contains("config does not exist"));
        assert!(error.contains(&config_path.display().to_string()));
    }

    #[test]
    fn existing_config_missing_render_section_fails_loudly() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        let templates_dir = dir.path().join("templates");
        let filters_dir = dir.path().join("filters");
        let figures_dir = dir.path().join("figures");
        fs::create_dir_all(&templates_dir).expect("templates dir must be writable");
        fs::create_dir_all(&filters_dir).expect("filters dir must be writable");
        fs::create_dir_all(&figures_dir).expect("figures dir must be writable");
        fs::write(
            &config_path,
            format!(
                r#"
[pandoc]
render_command = "pandoc -t html5"
templates_dir = "{}"
filters_dir = "{}"
figures_dir = "{}"
"#,
                templates_dir.display(),
                filters_dir.display(),
                figures_dir.display()
            ),
        )
        .expect("test config must be writable");

        let error = build_initial_state_from_config_path(&config_path).unwrap_err();

        assert!(error.contains("missing field `render`"));
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

        let error = build_initial_state_from_config_path(&config_path).unwrap_err();

        assert!(error.contains("missing field `render_command`"));
    }

    #[test]
    fn existing_config_missing_figures_dir_fails_loudly() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        let templates_dir = dir.path().join("templates");
        let filters_dir = dir.path().join("filters");
        fs::create_dir_all(&templates_dir).expect("templates dir must be writable");
        fs::create_dir_all(&filters_dir).expect("filters dir must be writable");

        fs::write(
            &config_path,
            format!(
                r#"
[render]
debounce_ms = 100
timeout_ms = 20000
restore_last_file = false

[pandoc]
render_command = "pandoc -t html5"
templates_dir = "{}"
filters_dir = "{}"
"#,
                templates_dir.display(),
                filters_dir.display()
            ),
        )
        .expect("test config must be writable");

        let error = build_initial_state_from_config_path(&config_path).unwrap_err();

        assert!(error.contains("missing field `figures_dir`"));
    }

    #[test]
    fn existing_config_missing_template_asset_fails_before_state_build() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        let templates_dir = dir.path().join("templates");
        let filters_dir = dir.path().join("filters");
        let figures_dir = dir.path().join("figures");
        fs::create_dir_all(&templates_dir).expect("templates dir must be writable");
        fs::create_dir_all(&filters_dir).expect("filters dir must be writable");
        fs::create_dir_all(&figures_dir).expect("figures dir must be writable");
        let missing_template = templates_dir.join("pandoc_preview_template.html");

        fs::write(
            &config_path,
            format!(
                r#"
[render]
debounce_ms = 100
timeout_ms = 20000
restore_last_file = false

[pandoc]
render_command = "pandoc --template={} -t html5"
templates_dir = "{}"
filters_dir = "{}"
figures_dir = "{}"
"#,
                missing_template.display(),
                templates_dir.display(),
                filters_dir.display(),
                figures_dir.display()
            ),
        )
        .expect("test config must be writable");

        let error = build_initial_state_from_config_path(&config_path).unwrap_err();

        assert!(error.contains("missing configured Pandoc template"));
        assert!(error.contains(&missing_template.display().to_string()));
    }

    #[test]
    fn existing_config_home_relative_template_flag_fails_before_render() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        let templates_dir = dir.path().join("templates");
        let filters_dir = dir.path().join("filters");
        let figures_dir = dir.path().join("figures");
        fs::create_dir_all(&templates_dir).expect("templates dir must be writable");
        fs::create_dir_all(&filters_dir).expect("filters dir must be writable");
        fs::create_dir_all(&figures_dir).expect("figures dir must be writable");

        fs::write(
            &config_path,
            format!(
                r#"
[render]
debounce_ms = 100
timeout_ms = 20000
restore_last_file = false

[pandoc]
render_command = "pandoc --template=~/.pandoc/templates/pandoc_preview_template.html -t html5"
templates_dir = "{}"
filters_dir = "{}"
figures_dir = "{}"
"#,
                templates_dir.display(),
                filters_dir.display(),
                figures_dir.display()
            ),
        )
        .expect("test config must be writable");

        let error = build_initial_state_from_config_path(&config_path).unwrap_err();

        assert!(error.contains("renderer shell does not expand `~` inside flag values"));
    }

    #[test]
    fn existing_config_missing_lua_filter_asset_fails_before_state_build() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        let templates_dir = dir.path().join("templates");
        let filters_dir = dir.path().join("filters");
        let figures_dir = dir.path().join("figures");
        let template = templates_dir.join("pandoc_preview_template.html");
        let missing_filter = filters_dir.join("tikzcd.lua");
        fs::create_dir_all(&templates_dir).expect("templates dir must be writable");
        fs::create_dir_all(&filters_dir).expect("filters dir must be writable");
        fs::create_dir_all(&figures_dir).expect("figures dir must be writable");
        fs::write(&template, "<!doctype html><html><body>$body$</body></html>")
            .expect("template must be writable");

        fs::write(
            &config_path,
            format!(
                r#"
[render]
debounce_ms = 100
timeout_ms = 20000
restore_last_file = false

[pandoc]
render_command = "pandoc --template={} --lua-filter={} -t html5"
templates_dir = "{}"
filters_dir = "{}"
figures_dir = "{}"
"#,
                template.display(),
                missing_filter.display(),
                templates_dir.display(),
                filters_dir.display(),
                figures_dir.display()
            ),
        )
        .expect("test config must be writable");

        let error = build_initial_state_from_config_path(&config_path).unwrap_err();

        assert!(error.contains("missing configured Pandoc lua-filter"));
        assert!(error.contains(&missing_filter.display().to_string()));
    }

    #[test]
    fn malformed_existing_config_fails_loudly() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        fs::write(&config_path, "[render\n").expect("test config must be writable");

        let error = build_initial_state_from_config_path(&config_path).unwrap_err();

        assert!(error.contains("failed to parse config"));
        assert!(error.contains(&config_path.display().to_string()));
    }

    #[test]
    fn complete_existing_config_builds_configured_initial_state() {
        let dir = tempfile::tempdir().expect("tempdir must be available");
        let config_path = dir.path().join("config.toml");
        let templates_dir = dir.path().join("templates");
        let filters_dir = dir.path().join("filters");
        let figures_dir = dir.path().join("figures");
        fs::create_dir_all(&templates_dir).expect("templates dir must be writable");
        fs::create_dir_all(&filters_dir).expect("filters dir must be writable");
        fs::create_dir_all(&figures_dir).expect("figures dir must be writable");
        fs::write(
            &config_path,
            format!(
                r#"
[render]
debounce_ms = 125
timeout_ms = 45000
restore_last_file = false

[pandoc]
render_command = "pandoc --standalone -t html5"
templates_dir = "{}"
filters_dir = "{}"
figures_dir = "{}"
"#,
                templates_dir.display(),
                filters_dir.display(),
                figures_dir.display()
            ),
        )
        .expect("test config must be writable");

        let state = build_initial_state_from_config_path(&config_path).unwrap();

        assert_eq!(state.render_command, "pandoc --standalone -t html5");
        assert_eq!(state.debounce_ms, 125);
        assert_eq!(state.timeout_ms, 45_000);
        assert!(!state.restore_last_file);
        assert_eq!(state.templates_dir, templates_dir);
        assert_eq!(state.filters_dir, filters_dir);
        assert_eq!(state.figures_dir, figures_dir);
    }
}
