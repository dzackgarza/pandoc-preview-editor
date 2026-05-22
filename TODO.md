# pandoc-preview TODO

## Not Done

- **Renderer diagnostics UI** — richer stderr/nonzero-exit display beyond the current
  error document, if needed.
- **Centralized Pandoc template/filter QA** — optional manual QA around
  `~/.pandoc/templates/` and `~/.pandoc/filters/`; app tests should stay
  renderer-agnostic.
- **Deprioritized active cards** — CriticMarkup GUI, agent chat, TikZJax, and
  renderer/filter settings are not next. They are either large, speculative,
  editor-behavior-heavy, or too close to renderer ownership for the current app
  boundary.
