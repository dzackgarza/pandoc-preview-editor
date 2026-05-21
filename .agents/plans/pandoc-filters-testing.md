# Feature: Centralized Pandoc Filter QA

## Problem

Users may have custom Pandoc filters installed in `~/.pandoc/filters/`. These filters
can do any post-processing of the AST,
including:
- Inlining tikz diagrams as rendered images
- Executing code blocks and inserting results (literate programming)
- Custom cross-references, footnotes, or bibliography processing
- Embedding external content

The app should not discover, own, or inject these filters. A Pandoc-based renderer
wrapper or config should reference centralized filters under `~/.pandoc/filters/`.

## Can This Already Be Done?

Yes. Running Pandoc with `--filter ~/.pandoc/filters/FILTER` works if the configured
renderer command or wrapper includes that argument.

This feature is not about app-owned filter request fields or project-local filter
folders. It is about proving the app invokes the configured renderer and surfaces its
stdout/stderr.

## Proposed Solution

Keep filter selection in the configured renderer command or wrapper. For Pandoc, the
central location is `~/.pandoc/filters/`.

App-level regression tests should use a real wrapper command that behaves like a renderer
and proves the renderer boundary. Pandoc filter correctness belongs to the centralized
Pandoc setup, not to app logic.

### Test: Tikz Image Inlining

Users commonly have a filter that converts tikz code blocks to embedded SVG or PNG
images (e.g., using `pandoc-tikz`, `panttikz`, or a custom script calling `pdflatex` +
`dvisvgm`/`convert`).

**Test document** (`tests/filters/tikz.md`):
````markdown
# Tikz Test

```tikz
\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}
````
````

**Expected output**: The HTML should contain an `<img>` tag or inline `<svg>`
element (depending on the filter), not the raw tikz source.

**Manual setup**: Requires:
- A tikz filter installed (e.g., `pandoc-tikz` via `pip install pandoc-tikz`)
- LaTeX distribution for `pdflatex`
- The filter referenced by the configured renderer command or wrapper

### Test: Live Code Block Execution

Filters like `pandoc-run` or custom lua filters can execute code blocks and
insert the output:

**Test document** (`tests/filters/run-code.md`):
```markdown
# Code Execution Test

```{.python .run}
print("Hello from python!")
````
````

**Expected output**: The HTML should contain the output "Hello from python!"
in a result block following the code block.

### Test: Combined Filter Pipeline

Test that multiple filters work together:
1. A metadata filter that processes YAML frontmatter
2. A code execution filter
3. A tikz rendering filter

### Implementation

- Do not create app-owned filter discovery logic.
- Do not add `/api/render` fields for filters.
- Test configured renderer invocation with a real wrapper.
- Use manual QA or a separate centralized Pandoc setup to validate the actual filters in
  `~/.pandoc/filters/`.

### Hardware/Sandboxing Note for Code Execution Filters

Filters that execute code blocks (`pandoc-run`, custom lua filters calling `os.execute`)
present a security boundary issue:
- Tests should run in a controlled environment
- The filter tests document that code execution filters require user opt-in
- The default pandoc command should NOT include code execution filters; users add them
  explicitly

### Pre-Flight: What Filters Actually Exist

Before implementing tests, survey the user's `~/.pandoc/filters/` directory:

- List all files
- Categorize: tikz filters, code execution filters, metadata, citations
- Check if each filter works with the current pandoc version
- Document which filters were tested and which failed

## Human Decisions Needed

- Whether to add a separate manual QA script for the centralized `~/.pandoc/filters/`
  setup outside the app test suite.

## Non-Goals

- Installing or managing pandoc filters (user responsibility)
- Writing filters for the user
- Testing filters that require external services (network, databases)
- App-owned filter discovery or filter injection
