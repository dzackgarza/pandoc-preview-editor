use serde::Serialize;

/// Represents a single filter flag in the render command.
/// `--lua-filter=path` and `--filter=path` (and space-separated variants).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FilterEntry {
    /// `lua-filter` or `filter`
    pub flag: String,
    /// The resolved filter path as it appears in the command
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MathEngine {
    None,
    MathJax,
    KaTeX,
    WebTeX,
}

/// Parsed representation of the render command string.
/// This is the single structured view derived from the raw command.
#[derive(Debug, Clone, Serialize)]
pub struct ParsedCommandFlags {
    pub command_name: String,
    pub standalone: bool,
    pub citeproc: bool,
    pub toc: bool,
    pub number_sections: bool,
    pub embed_resources: bool,
    pub math_engine: MathEngine,
    pub template: Option<String>,
    pub filters: Vec<FilterEntry>,
    /// Remaining flags and positional args not covered by structured fields
    pub other_args: Vec<String>,
}

impl ParsedCommandFlags {
    /// True when this filter entry was present in the original command string
    /// with the given absolute path.
    pub fn has_filter_with_path(&self, abs_path: &str) -> bool {
        self.filters.iter().any(|f| f.path == abs_path)
    }

    /// Reconstruct the command string from structured flags.
    /// Uses `shell_words::join` for correct shell quoting.
    /// Re-parsing the reconstructed string produces identical structured flags.
    pub fn reconstruct_command(&self) -> String {
        let mut tokens: Vec<String> = vec![self.command_name.clone()];

        if self.standalone {
            tokens.push("--standalone".into());
        }
        if self.citeproc {
            tokens.push("--citeproc".into());
        }
        if self.toc {
            tokens.push("--table-of-contents".into());
        }
        if self.number_sections {
            tokens.push("--number-sections".into());
        }
        if self.embed_resources {
            tokens.push("--embed-resources".into());
        }
        match self.math_engine {
            MathEngine::None => {}
            MathEngine::MathJax => tokens.push("--mathjax".into()),
            MathEngine::KaTeX => tokens.push("--katex".into()),
            MathEngine::WebTeX => tokens.push("--webtex".into()),
        }
        if let Some(ref tpl) = self.template {
            tokens.push(format!("--template={}", tpl));
        }
        for f in &self.filters {
            tokens.push(format!("--{}={}", f.flag, f.path));
        }
        tokens.extend(self.other_args.clone());

        shell_words::join(tokens)
    }
}

/// Parse a render command string into structured flags.
/// Uses `shell_words` for tokenization — the same tokenizer as the existing
/// Rust-side filter extraction.
pub fn parse_render_command(command: &str) -> Result<ParsedCommandFlags, String> {
    let tokens: Vec<String> =
        shell_words::split(command).map_err(|e| format!("invalid render command: {e}"))?;
    if tokens.is_empty() {
        return Err("render command must not be empty".into());
    }

    let command_name = tokens[0].clone();

    let mut standalone = false;
    let mut citeproc = false;
    let mut toc = false;
    let mut number_sections = false;
    let mut embed_resources = false;
    let mut math_engine = MathEngine::None;
    let mut template: Option<String> = None;
    let mut filters: Vec<FilterEntry> = vec![];
    let mut other_args: Vec<String> = vec![];

    let mut iter = tokens.iter().skip(1).peekable();
    while let Some(arg) = iter.next() {
        // Handle --template=path and --template path
        if let Some(path) = arg.strip_prefix("--template=") {
            template = Some(path.to_string());
            continue;
        }
        if arg == "--template" {
            if let Some(next) = iter.next() {
                template = Some(next.clone());
            }
            continue;
        }

        // Handle --lua-filter=path and --lua-filter path
        if let Some(path) = arg.strip_prefix("--lua-filter=") {
            filters.push(FilterEntry {
                flag: "lua-filter".into(),
                path: path.to_string(),
            });
            continue;
        }
        if arg == "--lua-filter" {
            if let Some(next) = iter.next() {
                filters.push(FilterEntry {
                    flag: "lua-filter".into(),
                    path: next.clone(),
                });
            }
            continue;
        }

        // Handle --filter=path and --filter path
        if let Some(path) = arg.strip_prefix("--filter=") {
            filters.push(FilterEntry {
                flag: "filter".into(),
                path: path.to_string(),
            });
            continue;
        }
        if arg == "--filter" {
            if let Some(next) = iter.next() {
                filters.push(FilterEntry {
                    flag: "filter".into(),
                    path: next.clone(),
                });
            }
            continue;
        }

        // Handle structured booleans
        if arg == "--standalone" {
            standalone = true;
            continue;
        }
        if arg == "--citeproc" {
            citeproc = true;
            continue;
        }
        if arg == "--table-of-contents" {
            toc = true;
            continue;
        }
        if arg == "--number-sections" {
            number_sections = true;
            continue;
        }
        if arg == "--embed-resources" {
            embed_resources = true;
            continue;
        }
        if arg == "--mathjax" {
            math_engine = MathEngine::MathJax;
            continue;
        }
        if arg == "--katex" {
            math_engine = MathEngine::KaTeX;
            continue;
        }
        if arg == "--webtex" {
            math_engine = MathEngine::WebTeX;
            continue;
        }

        // Everything else is an "other" argument
        other_args.push(arg.clone());
    }

    Ok(ParsedCommandFlags {
        command_name,
        standalone,
        citeproc,
        toc,
        number_sections,
        embed_resources,
        math_engine,
        template,
        filters,
        other_args,
    })
}
