# Feature: Obsidian Callouts → amsthm Rendering

## User Outcome

Obsidian-style callout blockquotes (`> [!THEOREM]`, `> [!PROOF]`, `> [!DEFINITION]`,
etc.)
in markdown source render as styled amsthm environments in the pandoc HTML preview,
with a configurable mapping from callout type to amsthm environment name.

## Current State

- Default pandoc pipeline includes `convert_amsthm_envs.lua` which maps pandoc fenced
  divs (`::: {.theorem}`) to `<div class="theorem proofenv">` in HTML output.
- A separate `obsidian_callouts.lua` filter exists at `~/.pandoc/bin/` that converts
  `> [!NOTE]` blockquotes to `<div class="callout" data-callout="note">`, but it is not
  included in the default pandoc args and does not generate amsthm-compatible markup.
- Neither filter is included in `pandoc-preview.toml`'s default `args` list by default
  (only `convert_amsthm_envs.lua` is).
  The two filters are independent and unaware of each other.

## What's Needed

### 1. Callout → amsthm mapping in the Lua filter chain

A filter (or extension to `obsidian_callouts.lua`) that, for callout types matching
known amsthm environments, produces the same HTML structure that
`convert_amsthm_envs.lua` emits: a `<div class="theorem proofenv">` (or
`<div class="lemma proofenv">`, etc.), so the template CSS styles it as a theorem block.

Callout types that do not match any amsthm environment (e.g., `[!NOTE]`, `[!WARNING]`,
`[!INFO]`) should continue to render as generic callout divs for CSS styling.

### 2. Configuration-driven mapping

The mapping from callout name → amsthm environment should be configurable, since:

- Users may use different callout names for the same theorem type.
- New theorem types may be added via amsthm's `\newtheorem` in the LaTeX template.
- The finite set of supported types needs to be synced between the pandoc filter and the
  HTML/CSS/LaTeX definitions.

Possible config approaches (not mutually exclusive):

| Approach | Pros | Cons |
| --- | --- | --- |
| Config file (TOML/JSON) loaded by the Lua filter | Explicit, version-controllable, sharable | Lua filter needs file I/O or env-var path |
| In-document metadata block | Self-documenting, per-document overrides | Repetitive across documents |
| Pandoc metadata variables (`--metadata=callout-map:...`) | No extra files, passes through pandoc's `--metadata` | Cumbersome for verbose maps |
| Hard-coded default + env var override in filter | Simple, no config surface until needed | Opaque to the user |

Prefer a standalone config file (e.g., `.pandoc/callout-amsthm-map.toml`) that maps
callout names to environment names, loaded by a combined or post-process Lua filter.

### 3. Inclusion in default pandoc args

The filter that handles callout→amsthm conversion must be added to
`pandoc-preview.toml`'s `[pandoc] args` list, so new projects get it by default.

## Ownership

- **Filter logic**: Server-side (Lua filter in `~/.pandoc/bin/` or bundled with the
  app).
- **Config schema**: Defined in the app's docs, loaded by the filter at render time.
- **CSS styling**: Template (`pandoc_HTML.template`) already handles `.theorem`,
  `.proofenv` classes via `convert_amsthm_envs.lua` output — no new template changes
  needed if the callout filter reuses the same class conventions.
- **App changes**: Only the default `pandoc-preview.toml` args list (add the new
  filter).

## Existing Dependencies

- `~/.pandoc/bin/convert_amsthm_envs.lua` — canonical `<div class="proofenv">` generator
- `~/.pandoc/bin/obsidian_callouts.lua` — existing callout parser (can be extended or
  replaced by a combined filter)
- `pandoc-preview.toml` — default pandoc args

## Non-goals

- Do not build a Settings UI for the callout map.
  Keep it in config files.
- Do not render callout types that have no amsthm mapping as theorem blocks — they
  should remain generic callouts with CSS-based styling.
