# Feature: AMSthm Block Rendering Test

## Problem

Users writing mathematical documents often use AMS theorem environments (theorem, lemma,
proof, definition, remark, etc.)
defined in their pandoc HTML template via CSS. These depend on:
- Correct HTML structure from pandoc (using `--mathjax` and fenced divs or custom raw
  HTML blocks)
- Correct CSS styling in the template (`~/.pandoc/templates/default.html`)
- Proper interaction with MathJax for theorem content containing math

If the template's theorem styling is broken, the mathematical content may still render
but lose its semantic structure (no colored theorem boxes, no proof end markers, missing
labels).

## Can This Already Be Done?

Viewing the rendered HTML in a browser or running pandoc on the command line would show
the same output. The question is whether the app's pipeline correctly renders the
combination of:
- Custom HTML template with theorem CSS
- MathJax rendering within theorem blocks
- Fenced divs (`::: theorem` ... `:::`) from pandoc's markdown extensions

This can be verified manually by the user.
An automated test saves time when modifying the template or upgrading pandoc.

## Proposed Solution

### Test Document

Create `tests/amsthm.md`:

```markdown
---
title: AMS Theorem Test
---

# Theorem Environment Test

::: theorem
**Theorem 1 (Pythagoras).**
For a right triangle with legs $a$ and $b$ and hypotenuse $c$,
we have $a^2 + b^2 = c^2$.
:::

::: proof
\begin{align*}
a^2 + b^2 &= c^2 \\
e^{i\pi} + 1 &= 0
\end{align*}
:::

::: lemma
**Lemma 2.** $1 + 1 = 2$.
:::

::: definition
**Definition 3.** A prime number is a natural number greater than 1
that has no positive divisors other than 1 and itself.
:::

::: remark
**Remark 4.** This is a remark.
:::

::: example
**Example 5.** The integers $\mathbb{Z}$ form a ring.
:::

::: corollary
**Corollary 6.** $2 + 2 = 4$.
:::
```

Note: The exact fenced div syntax depends on the user's pandoc configuration and
template. Pandoc's built-in `--to html` does not automatically style theorem
environments; they require CSS in the template and may use custom pandoc lua filters
(e.g., `pandoc-xnos` for theorem numbering).

### What to Test

1. **HTML structure**: Each fenced div produces a `<div>` with the appropriate class
   (e.g., `<div class="theorem">`, `<div class="proof">`)
2. **Math rendering**: MathJax (or MathML) renders the inline and display math within
   theorem blocks correctly
3. **CSS application**: The classes from the template CSS apply visible styling (colors,
   borders, backgrounds)
4. **Numbering**: If using `pandoc-xnos` or similar, theorem numbers increment correctly
5. **Proof end marker**: The proof environment shows a QED symbol (∎) at the end

### Test Procedure

1. Render the test document through the app's pipeline
2. Check the HTML output for:
   - `class="theorem"`, `class="proof"`, `class="lemma"`, etc.
   - MathJax delimiters are processed (no raw `$...$` left in HTML)
   - No pandoc rendering errors (check stderr)
3. Visual inspection is required for CSS styling (automated screenshot comparison is
   future work)
4. Run after any change to: HTML template, pandoc command, MathJax config, or custom
   filters

### Expected Output Pattern

```html
<div class="theorem">
  <p><strong>Theorem 1 (Pythagoras).</strong>
  For a right triangle with legs <span class="math inline">a</span>
  ...</p>
</div>
<div class="proof">
  <p>...</p>
</div>
```

The exact output depends on the template and filters.

## Dependencies

This test requires:
- A pandoc HTML template with AMS theorem CSS (in `~/.pandoc/templates/`)
- Pandoc compiled with `--mathjax` support (or equivalent math rendering)
- Optional: `pandoc-xnos` or similar for theorem numbering
- The fenced div syntax enabled in pandoc (default in recent versions)

## Risks

- The test document is tightly coupled to the user's specific template and filter setup.
  It may fail on a different machine with different config.
- Mitigation: Document the required setup.
  Make the test skippable if dependencies are not met.
  Use a `.amsthmrc` or similar config file if the test needs parameterization.

## Human Decisions Needed

1. **Should this test be automated or manual?** Automated HTML structure checking is
   feasible. Visual CSS checking requires screenshots.
   Start with HTML structure checks and manual visual inspection.
2. **Scope**: Just fenced divs, or also raw HTML theorem environments
   (`<div class="theorem">` written directly in markdown)?
   Start with fenced divs (pandoc-native) and add raw HTML if needed.
3. **Cross-machine portability**: Should the test be skipped in CI if the
   template/filters aren't present?
   Yes -- make it a local-only test.
