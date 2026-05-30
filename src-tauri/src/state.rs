use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;

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
            let backup = crate::config::get_backup_path(path);
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

pub fn probe_tool_state() -> HashMap<String, ToolEntry> {
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

pub fn tool_id_for_ext(ext: &str) -> &'static str {
    DIAGRAM_TOOLS
        .iter()
        .find(|t| t.ext == ext)
        .map(|t| t.id)
        .unwrap_or("inkscape")
}

pub fn starter_template_for_tool(tool_id: &str) -> &'static str {
    DIAGRAM_TOOLS
        .iter()
        .find(|t| t.id == tool_id)
        .map(|t| t.starter_template)
        .unwrap_or("")
}

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
