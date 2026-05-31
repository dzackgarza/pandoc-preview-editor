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
pub fn parse_render_command(command: &str) -> ParsedCommandFlags {
    let tokens: Vec<String> = shell_words::split(command).unwrap_or_default();
    if tokens.is_empty() {
        return ParsedCommandFlags {
            command_name: "pandoc".into(),
            standalone: false,
            citeproc: false,
            toc: false,
            number_sections: false,
            embed_resources: false,
            math_engine: MathEngine::None,
            template: None,
            filters: vec![],
            other_args: vec![],
        };
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

    ParsedCommandFlags {
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_yields_pandoc() {
        let flags = parse_render_command("");
        assert_eq!(flags.command_name, "pandoc");
        assert!(flags.filters.is_empty());
    }

    #[test]
    fn parse_just_pandoc() {
        let flags = parse_render_command("pandoc");
        assert_eq!(flags.command_name, "pandoc");
        assert!(!flags.standalone);
        assert!(flags.filters.is_empty());
    }

    #[test]
    fn parse_finds_lua_filter_flags() {
        let flags = parse_render_command(
            "pandoc --lua-filter=/a/f.lua --filter /b/f.py --lua-filter=/c/g.lua",
        );
        assert_eq!(flags.filters.len(), 3);
        assert_eq!(flags.filters[0].flag, "lua-filter");
        assert_eq!(flags.filters[0].path, "/a/f.lua");
        assert_eq!(flags.filters[1].flag, "filter");
        assert_eq!(flags.filters[1].path, "/b/f.py");
        assert_eq!(flags.filters[2].flag, "lua-filter");
        assert_eq!(flags.filters[2].path, "/c/g.lua");
    }

    #[test]
    fn parse_finds_equals_form() {
        let flags = parse_render_command("pandoc --lua-filter=~/.pandoc/f.lua");
        assert_eq!(flags.filters.len(), 1);
        assert_eq!(flags.filters[0].path, "~/.pandoc/f.lua");
    }

    #[test]
    fn parse_empty_when_no_filters() {
        let flags = parse_render_command("pandoc --standalone -t html5");
        assert!(flags.filters.is_empty());
        assert!(flags.standalone);
    }

    #[test]
    fn parse_structured_booleans() {
        let flags = parse_render_command(
            "pandoc --standalone --citeproc --table-of-contents --number-sections --embed-resources",
        );
        assert!(flags.standalone);
        assert!(flags.citeproc);
        assert!(flags.toc);
        assert!(flags.number_sections);
        assert!(flags.embed_resources);
    }

    #[test]
    fn parse_math_engine() {
        let flags = parse_render_command("pandoc --mathjax");
        assert_eq!(flags.math_engine, MathEngine::MathJax);

        let flags = parse_render_command("pandoc --katex");
        assert_eq!(flags.math_engine, MathEngine::KaTeX);

        let flags = parse_render_command("pandoc --webtex");
        assert_eq!(flags.math_engine, MathEngine::WebTeX);
    }

    #[test]
    fn parse_template_equals_form() {
        let flags = parse_render_command("pandoc --template=mytpl.html");
        assert_eq!(flags.template.unwrap(), "mytpl.html");
    }

    #[test]
    fn parse_template_space_form() {
        let flags = parse_render_command("pandoc --template mytpl.html");
        assert_eq!(flags.template.unwrap(), "mytpl.html");
    }

    #[test]
    fn parse_other_args_preserved() {
        let flags =
            parse_render_command("pandoc --standalone -t html5 -f markdown+tex_math_dollars");
        assert!(flags.standalone);
        assert_eq!(
            flags.other_args,
            vec!["-t", "html5", "-f", "markdown+tex_math_dollars"]
        );
    }

    fn split_shell(command: &str) -> Vec<String> {
        shell_words::split(command).expect("test command must be valid shell syntax")
    }

    /// Helper: parse-reconstruct-reparse and assert command behavior is preserved.
    fn assert_round_trip_argv(cmd: &str, expected_reconstructed: &[&str]) {
        let original = parse_render_command(cmd);
        let reconstructed = original.reconstruct_command();
        let reconstructed_argv = split_shell(&reconstructed);
        assert_eq!(
            reconstructed_argv, expected_reconstructed,
            "reconstructed argv mismatch for: {cmd}\nreconstructed command: {reconstructed}"
        );

        let reparsed = parse_render_command(&reconstructed);
        assert_eq!(
            original.standalone, reparsed.standalone,
            "standalone mismatch for: {cmd}"
        );
        assert_eq!(
            original.citeproc, reparsed.citeproc,
            "citeproc mismatch for: {cmd}"
        );
        assert_eq!(original.toc, reparsed.toc, "toc mismatch for: {cmd}");
        assert_eq!(
            original.number_sections, reparsed.number_sections,
            "number_sections mismatch for: {cmd}"
        );
        assert_eq!(
            original.embed_resources, reparsed.embed_resources,
            "embed_resources mismatch for: {cmd}"
        );
        assert_eq!(
            original.math_engine, reparsed.math_engine,
            "math_engine mismatch for: {cmd}"
        );
        assert_eq!(
            original.template, reparsed.template,
            "template mismatch for: {cmd}"
        );
        assert_eq!(
            original.filters, reparsed.filters,
            "filters mismatch for: {cmd}"
        );
        assert_eq!(
            original.other_args, reparsed.other_args,
            "other_args mismatch for: {cmd}"
        );
    }

    #[test]
    fn round_trip_basic() {
        assert_round_trip_argv(
            "pandoc --standalone -t html5",
            &["pandoc", "--standalone", "-t", "html5"],
        );
    }

    #[test]
    fn round_trip_with_filters() {
        assert_round_trip_argv(
            "pandoc --standalone --lua-filter=/a/f.lua --filter=/b/f.py --lua-filter=/c/g.lua -t html5",
            &[
                "pandoc",
                "--standalone",
                "--lua-filter=/a/f.lua",
                "--filter=/b/f.py",
                "--lua-filter=/c/g.lua",
                "-t",
                "html5",
            ],
        );
    }

    #[test]
    fn round_trip_with_template() {
        assert_round_trip_argv(
            "pandoc --standalone --template=tpl.html -t html5",
            &[
                "pandoc",
                "--standalone",
                "--template=tpl.html",
                "-t",
                "html5",
            ],
        );
    }

    #[test]
    fn round_trip_math() {
        assert_round_trip_argv(
            "pandoc --mathjax --standalone -t html5",
            &["pandoc", "--standalone", "--mathjax", "-t", "html5"],
        );
    }

    #[test]
    fn round_trip_all_flags() {
        assert_round_trip_argv(
            "pandoc --standalone --citeproc --table-of-contents --number-sections --embed-resources --mathjax --template=tpl.html --lua-filter=f1.lua --lua-filter=f2.lua --filter=f3.py -t html5 -f markdown",
            &[
                "pandoc",
                "--standalone",
                "--citeproc",
                "--table-of-contents",
                "--number-sections",
                "--embed-resources",
                "--mathjax",
                "--template=tpl.html",
                "--lua-filter=f1.lua",
                "--lua-filter=f2.lua",
                "--filter=f3.py",
                "-t",
                "html5",
                "-f",
                "markdown",
            ],
        );
    }

    #[test]
    fn round_trip_quoted_paths_preserves_argv() {
        assert_round_trip_argv(
            "pandoc --standalone --template 'templates/acme preview.html' --lua-filter 'filters/tikz diagrams.lua' -t html5",
            &[
                "pandoc",
                "--standalone",
                "--template=templates/acme preview.html",
                "--lua-filter=filters/tikz diagrams.lua",
                "-t",
                "html5",
            ],
        );
    }

    #[test]
    fn has_filter_with_path_matches() {
        let flags = parse_render_command(
            "pandoc --lua-filter=/home/user/.pandoc/filters/f1.lua --lua-filter=/other/f2.lua",
        );
        assert!(flags.has_filter_with_path("/home/user/.pandoc/filters/f1.lua"));
        assert!(!flags.has_filter_with_path("/nonexistent/f.lua"));
    }
}
