# Feature: Default CriticMarkup Rendering via pancritic

## User Outcome

CriticMarkup syntax (deletions `{-- --}`, additions `{++ ++}`, substitutions
`{~~ ~> ~~}`, highlights `{== ==}`, comments `{>> <<}`) renders correctly in the live
preview instead of appearing as raw syntax.

## Can This Already Be Done?

Manually: the user can wrap or replace the pandoc command with
[`pancritic`](https://github.com/ickc/pancritic) by editing `pandoc-preview.toml`. The
point is to make it work out of the box.

## Integration

The default config (`pandoc-preview.toml`) should pipe markdown through pancritic before
reaching the configured renderer.
pancritic supports pandoc-compatible output formats and can act as a pure preprocessor
(`pancritic -t markdown -m d`).

The simplest default: ship a bundled wrapper script as the default renderer command that
chains pancritic with pandoc, or detect pancritic at startup and insert it into the
render pipeline automatically in `src/server/render.ts`.

## Non-Goals

- No CriticMarkup-specific UI controls, mode selectors, or request fields.
  It just renders correctly.
- No Python dependency enforcement — degrade gracefully if pancritic isn't installed.
