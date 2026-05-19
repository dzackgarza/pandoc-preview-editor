# Feature Evaluation Philosophy

---
status: active
tags: [pandoc-preview, feature-evaluation, design-philosophy]
---

Every feature MUST be evaluated against two questions, in order:

1. **Can nvim natively do this?** — Does the feature already exist as an nvim plugin, built-in command, or statusline element?
2. **Does this need to be in the glued GUI?** — If nvim handles it, the GUI should NOT build a parallel system.

### How to Apply

- **Define the feature by user outcome, not by GUI widget.** Wrong: "Display buffer modified status in the GUI." Right: "The user knows when the buffer != disk." (nvim-airline handles this.)

- **Extend the existing protocol, don't build parallel systems.** The app has a bidirectional TCP connection to nvim. If the GUI needs editor state, extend that protocol — don't poll disk, don't add file-watchers, don't build state tracking parallel to nvim's.

- **Research before claiming.** "Can This Already Be Done?" sections require actual research — verify nvim plugins, check their docs, get real star counts. Fabricated claims short-circuit the entire evaluation process.

- **Flag for human decision, don't unilaterally skip.** If nvim handles the outcome, present the research and flag for human decision. The card verdict must be "Research → Human Decision" unless the decision is truly trivial.
