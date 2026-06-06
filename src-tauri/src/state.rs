use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

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
pub struct FileFingerprint {
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: u64,
    pub hash: String,
}

#[derive(Debug)]
pub struct AppState {
    pub render_command: String,
    pub parsed_flags: crate::command_flags::ParsedCommandFlags,
    pub timeout_ms: u64,
    pub file: Option<PathBuf>,
    pub file_content: Option<String>,
    pub workspace_root: Option<PathBuf>,
    pub is_temp_file: bool,
    pub config_path: Option<PathBuf>,
    pub templates_dir: PathBuf,
    pub filters_dir: PathBuf,
    pub figures_dir: PathBuf,
    pub debounce_ms: u64,
    pub launcher_command: Option<String>,
    pub recovered_from_backup: bool,
    pub restore_last_file: bool,
    pub plugins: Vec<PluginManifest>,
    pub recent_files: Vec<PathBuf>,
    pub file_fingerprints: HashMap<String, FileFingerprint>,
    pub tool_state: HashMap<String, ToolEntry>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolEntry {
    pub cmd: String,
}

impl AppState {
    pub fn workspace_root(&self) -> Result<PathBuf, String> {
        if let Some(ref root) = self.workspace_root {
            return Ok(root.clone());
        }
        if let Some(ref file) = self.file {
            if let Some(parent) = file.parent() {
                return Ok(parent.to_path_buf());
            }
        }
        std::env::current_dir().map_err(|e| {
            format!(
                "Failed to determine workspace root and current directory is inaccessible: {}",
                e
            )
        })
    }

    pub fn document_root(&self) -> Result<PathBuf, String> {
        if let Some(ref file) = self.file {
            if !self.is_temp_file {
                if let Some(parent) = file.parent() {
                    return Ok(parent.to_path_buf());
                }
            }
        }
        self.workspace_root()
    }

    pub fn current_file_content(&self) -> Result<String, String> {
        if let Some(ref path) = self.file {
            let backup = crate::config::get_backup_path(path)?;
            if backup.exists() {
                return fs::read_to_string(&backup)
                    .map_err(|e| format!("failed to read backup {}: {e}", backup.display()));
            }
            if path.exists() {
                return fs::read_to_string(path)
                    .map_err(|e| format!("failed to read active file {}: {e}", path.display()));
            }
            // A pending New target has no disk file until the first save.
            return self.file_content.clone().ok_or_else(|| {
                format!(
                    "File {} does not exist on disk and no content is held in memory",
                    path.display()
                )
            });
        }
        self.file_content
            .clone()
            .ok_or_else(|| "No file is currently loaded in state".to_string())
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagramToolDef {
    id: String,
    executables: Vec<String>,
    ext: String,
}

fn load_diagram_tools() -> Vec<DiagramToolDef> {
    let json = include_str!("../../src/shared/diagram-tools.json");
    serde_json::from_str(json).expect("diagram-tools.json must be valid JSON")
}

use std::sync::LazyLock;
static DIAGRAM_TOOLS: LazyLock<Vec<DiagramToolDef>> = LazyLock::new(load_diagram_tools);

pub fn probe_tool_state() -> HashMap<String, ToolEntry> {
    let mut map = HashMap::new();
    for tool in &*DIAGRAM_TOOLS {
        let found = tool
            .executables
            .iter()
            .find(|e| is_command_available(e))
            .unwrap_or_else(|| {
                panic!(
                    "Missing hard dependency: none of the executables for diagram tool '{}' ({:?}) were found in PATH. Ensure all required mathematical research tools are installed.",
                    tool.id, tool.executables
                )
            });

        map.insert(tool.id.clone(), ToolEntry { cmd: found.clone() });
    }
    map
}

pub fn tool_id_for_ext(ext: &str) -> Option<&str> {
    DIAGRAM_TOOLS
        .iter()
        .find(|t| t.ext == ext)
        .map(|t| t.id.as_str())
}

pub fn starter_template_for_tool(tool_id: &str) -> Result<String, String> {
    // We try to use include_str! to bake them in during compilation rather than relying on fs at runtime
    match tool_id {
        "qtikz" => {
            Ok(include_str!("../../src-tauri/assets/diagram-templates/qtikz.tikz").to_string())
        }
        "tikzit" => {
            Ok(include_str!("../../src-tauri/assets/diagram-templates/tikzit.tikz").to_string())
        }
        "inkscape" => {
            Ok(include_str!("../../src-tauri/assets/diagram-templates/inkscape.svg").to_string())
        }
        "xournalpp" => {
            Ok(include_str!("../../src-tauri/assets/diagram-templates/xournalpp.xopp").to_string())
        }
        "ipe" => Ok(include_str!("../../src-tauri/assets/diagram-templates/ipe.ipe").to_string()),
        _ => Err(format!("unknown diagram tool: {tool_id}")),
    }
}

pub fn all_diagram_tool_ids() -> Vec<String> {
    DIAGRAM_TOOLS.iter().map(|t| t.id.clone()).collect()
}

fn is_command_available(cmd: &str) -> bool {
    which::which(cmd).is_ok()
}
