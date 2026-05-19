# Feature: Test All Filters in ~/.pandoc

## Problem

Users may have custom pandoc filters installed in `~/.pandoc/filters/` (or on the
`PANODC_FILTERS_PATH`). These filters can do anything post-processing of the AST,
including:
- Inlining tikz diagrams as rendered images
- Executing code blocks and inserting results (literate programming)
- Custom cross-references, footnotes, or bibliography processing
- Embedding external content

The app's preview pipeline (pandoc -> HTML) should correctly handle these filters.
But there is no test suite that exercises filters, so regressions go unnoticed.

## Can This Already Be Done?

Running pandoc with `--filter FILTER` on the command line already works if the user
configures it. The question is whether the integration is tested.

This feature is about creating test documents that exercise specific filter behaviors
and verifying the output contains expected HTML patterns.
These are integration tests for the pandoc pipeline, not unit tests for the app.

## Proposed Solution

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

**Setup**: Requires:
- A tikz filter installed (e.g., `pandoc-tikz` via `pip install pandoc-tikz`)
- LaTeX distribution for `pdflatex`
- The filter configured in the pandoc command

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

1. Create `tests/filters/` directory with test markdown files
2. Each test file has an associated `.expected.html` file (the expected
   pandoc output with filters applied)
3. Test script runs pandoc with the configured filters and compares output
   to expected

```typescript
// tests/filters.test.ts
import { execSync } from 'child_process';

const filtersDir = path.join(__dirname, 'filters');

function runPandocWithFilters(mdFile: string): string {
  const filters = fs.readdirSync(expandHome('~/.pandoc/filters'))
    .filter(f => f.endsWith('.lua') || f.endsWith('.py'))
    .map(f => `--filter=${path.join(expandHome('~/.pandoc/filters'), f)}`);

  return execSync(
    `pandoc ${mdFile} --from markdown --to html ${filters.join(' ')}`,
    { encoding: 'utf-8' }
  );
}

test('tikz filter renders SVG', () => {
  const html = runPandocWithFilters('tests/filters/tikz.md');
  expect(html).toContain('<svg');
  expect(html).toContain('</svg>');
});

test('code execution filter inserts output', () => {
  const html = runPandocWithFilters('tests/filters/run-code.md');
  expect(html).toContain('Hello from python');
});
````

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

1. **Test scope**: Test all discovered filters, or just the common ones (tikz, code
   execution)? Test all discovered filters, with skip annotations for broken ones.
2. **Filter survey**: Run the survey and report findings before building tests.
3. **CI integration**: Should filter tests run in CI? They require pandoc + specific
   filter packages. Likely CI-skip unless the CI image has them.

## Non-Goals

- Installing or managing pandoc filters (user responsibility)
- Writing filters for the user
- Testing filters that require external services (network, databases)
