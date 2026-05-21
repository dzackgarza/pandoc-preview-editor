# Feature: Renderer Command Configuration

## Problem

The renderer command and its arguments are read from `pandoc-preview.toml`.
Users who want to:
- Use a different renderer binary or wrapper
- Add renderer-specific arguments
- Change the output format
- Set environment variables outside the app
- Use a different markdown engine entirely

should do that through the config-owned renderer command.

## Can This Already Be Done?

Yes. The app starts only when `pandoc-preview.toml` supplies `[pandoc] command` and
`args`. Despite the historical section name, this is the renderer command surface.
The app must not interpret Pandoc-specific flags or expose GUI fields for them.

## Proposed Solution

Keep renderer command configuration in `pandoc-preview.toml`.

The render API accepts document text and invokes the configured command exactly as the
server loaded it. Renderer-specific templates, filters, formats, bibliography settings,
and math settings belong in the configured command or in a wrapper script, not in
request fields or GUI controls.

For Pandoc-based renderers, templates and filters should be centralized under
`~/.pandoc/templates/` and `~/.pandoc/filters/`. Project code should not introduce
alternate app-owned template or filter directories.

Regression tests should prove:

- the server refuses to start without config
- the configured command is invoked
- stderr and nonzero exits surface through the preview response
- a non-Pandoc renderer wrapper can be used

## Human Decisions Needed

- Whether to rename `[pandoc]` in the config to `[renderer]`.

## Future Possibilities

- Per-project config files
- A read-only UI display of the active renderer command
