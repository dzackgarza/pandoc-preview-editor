# Plan: Consolidate Render Command Parsing

## Goal

- Current defect/state: The render command string is parsed independently in 4 sites — `extract_filter_paths` (Rust, `shell_words`), `remove_filter_flags` (Rust, `shell_words`), `parseCommand` (TS, `shell-quote` + `minimist`), `buildCommand` (TS, `shell-quote`). No integration test verifies `buildCommand(parseCommand(X)) = X`. Two Rust functions duplicate the same tokenization + filter-flag scanning logic.

- Target state: The command string is parsed **once** in Rust at config load time. The structured representation lives in `AppState`. All Rust consumers read from state — no ad-hoc re-parsing. The client receives structured flags from Rust via `get_config` and no longer runs its own independent parser. `buildCommand` (TS) remains for reconstructing the command string when the user modifies structured controls in the Settings dialog.

- Why this matters: Scattered parsing with different tokenizers (`shell_words` vs `shell-quote` + `minimist`) means the four consumers can silently disagree on what the command string contains. The Settings UI can corrupt the command string on save with no round-trip guard. This is a silent data-corruption vector in a tool where the user's research pipeline depends on exact reproducibility of the render command.

## Constraints

- Required: The raw command string remains the single source of truth in config. Structured flags are a cache derived from it.
- Required: `settings.toml` format unchanged.
- Required: Existing tests must pass (5 in `render.rs`, 3 in `commands.rs`, 1 in `config.rs`).
- Required: The Settings raw-command textarea must remain the authoritative view that mirrors the structured controls.
- Forbidden: Adding app-owned config keys for renderer-specific flags.
- Forbidden: Changing the `render()` command path — it still passes the raw string to `zsh -c`.
- Forbidden: Removing the structured-UI-to-raw-command round-trip behavior in Settings.
- Approval gates: Plan approval before implementation.

## Prerequisites

- Access: Read/write access to all source files
- Tools/environment: `cargo test`, `just typecheck`, `just test`
- External dependencies: `shell-words` crate (already in Cargo.toml), `shell-quote` npm (already in package.json)

## Scope

- Included targets:
  - New `src-tauri/src/command_flags.rs` — owns `ParsedCommandFlags` struct + single parser
  - `src-tauri/src/state.rs` — add `parsed_flags: ParsedCommandFlags` field to `AppState`
  - `src-tauri/src/config.rs` — parse command in `build_initial_state`, re-parse in `set_config`
  - `src-tauri/src/render.rs` — delete `extract_filter_paths`, delete `remove_filter_flags`
  - `src-tauri/src/commands.rs` — rewrite `list_filters`, `toggle_filters`, `get_config` to use `AppState.parsed_flags`
  - `src/shared/command-parser.ts` — remove `parseCommand`, keep `buildCommand`
  - `src/client/components/SettingsDialog.tsx` — receive structured flags from `get_config` response instead of calling `parseCommand`
  - `src-tauri/src/render.rs` — delete the 5 tests for `extract_filter_paths`/`remove_filter_flags`; add new tests for `ParsedCommandFlags` parser/round-trip
- Excluded/deprecated targets:
  - `render()` command (line 69 in commands.rs) — unchanged
  - `buildCommand` in TS — kept, unchanged
  - The Settings raw-command textarea — unchanged
  - Plugin commands — out of scope

## Phases

### Phase 0: Add structured flags type + single Rust parser

Goal: A new `command_flags.rs` module with a `ParsedCommandFlags` struct and a single
`parse_render_command(command: &str) -> ParsedCommandFlags` function that extracts all
flags currently used by both Rust and TS consumers. No consumers wired up yet.

Tasks:

- Location: `src-tauri/src/command_flags.rs` (new file)
- Description: Define `ParsedCommandFlags` struct with fields: `command_name: String`, `filters: Vec<FilterEntry>` (each with `flag_type: LuaFilter | Filter`, `path: String`, `is_inline: bool`), `template: Option<String>`, `standalone: bool`, `citeproc: bool`, `toc: bool`, `number_sections: bool`, `embed_resources: bool`, `math_engine: MathEngine` (enum: `None | MathJax | KaTeX | WebTeX`), `other_args: Vec<String>`. Implement `parse_render_command` using `shell_words::split` + manual iteration. Implement `reconstruct_command(&self) -> String` using `shell_words::join`.
- Dependencies: None (new module)
- Acceptance criteria: `parse_render_command` returns correct `ParsedCommandFlags` for all flag types. `reconstruct_command(parse_render_command(X)) == X` for all test inputs.
- Validation: `#[cfg(test)] mod tests` in `command_flags.rs` with round-trip tests covering all flag types, empty command, only-other-flags, multiple filters, equals-form and space-separated form.

- Location: `src-tauri/src/lib.rs`
- Description: Add `pub mod command_flags;`
- Dependencies: `command_flags.rs` exists
- Acceptance criteria: Project compiles with new module
- Validation: `cargo check --manifest-path src-tauri/Cargo.toml`

### Phase 1: Wire structured flags into AppState + config flow

Goal: `AppState` holds a `ParsedCommandFlags`. `build_initial_state` parses once on startup. `set_config` re-parses when command changes. `get_config` returns parsed flags to client. No consumer changes yet.

Tasks:

- Location: `src-tauri/src/state.rs`
- Description: Add `pub parsed_flags: command_flags::ParsedCommandFlags` field to `AppState`. Import `crate::command_flags`.
- Dependencies: Phase 0 complete
- Acceptance criteria: Project compiles. `AppState` has the new field.
- Validation: `cargo check --manifest-path src-tauri/Cargo.toml`

- Location: `src-tauri/src/config.rs` — `build_initial_state`
- Description: After constructing `render_command` string, call `parse_render_command(&render_command)` and store result in `parsed_flags` field. Import `crate::command_flags::parse_render_command`.
- Dependencies: Phase 1 state.rs change
- Acceptance criteria: `AppState` is built with `parsed_flags` populated.
- Validation: `cargo check --manifest-path src-tauri/Cargo.toml`

- Location: `src-tauri/src/commands.rs` — `set_config`
- Description: After setting `s.render_command`, call `parse_render_command(&render_command)` and store in `s.parsed_flags`.
- Dependencies: Phase 1 state.rs change
- Acceptance criteria: `set_config` updates both `render_command` (string) and `parsed_flags` (structured).
- Validation: `cargo check --manifest-path src-tauri/Cargo.toml`

- Location: `src-tauri/src/commands.rs` — `get_config`
- Description: Add `"parsedFlags": serde_json::to_value(&s.parsed_flags).unwrap()` to the returned JSON.
- Dependencies: `ParsedCommandFlags` must derive `Serialize`. Phase 1 state.rs change.
- Acceptance criteria: `get_config` response includes `parsedFlags` field with structured flag data.
- Validation: `cargo check --manifest-path src-tauri/Cargo.toml`

### Phase 2: Migrate Rust consumers to use AppState.parsed_flags

Goal: `list_filters` and `toggle_filters` read from/write to `AppState.parsed_flags` instead of calling `extract_filter_paths`/`remove_filter_flags`. Delete the two functions from `render.rs`.

Tasks:

- Location: `src-tauri/src/commands.rs` — `list_filters`
- Description: Replace calls to `extract_filter_paths` with reading `s.parsed_flags.filters`. Build the `active` HashSet from `parsed_flags.filters` entries directly. The function no longer needs `shell_words`/`dirs` imports for filter extraction (but `dirs` is still used elsewhere in the file).
- Dependencies: Phase 1 complete (`parsed_flags` populated)
- Acceptance criteria: `list_filters` returns identical JSON output to the old behavior for the same command string. Filters marked `enabled: true` match those in the command string.
- Validation: Existing filter unit tests pass (`cargo test`). Manual check: list_filters output matches expected for a known command string.

- Location: `src-tauri/src/commands.rs` — `toggle_filters`
- Description: Instead of calling `remove_filter_flags`, modify `s.parsed_flags.filters` directly: compute new filter list from `enabled` names, set `s.parsed_flags.filters` to the new list, call `s.parsed_flags.reconstruct_command()` to get the new command string, store and persist.
- Dependencies: Phase 1 complete. `ParsedCommandFlags::reconstruct_command` exists.
- Acceptance criteria: `toggle_filters` produces the same command string as the old implementation for identical inputs. Filters dir scoping (only toggle `filters_dir` filters) preserved.
- Validation: The behavioral equivalence can be verified by comparing output of old `remove_filter_flags`-based reconstruction with new `ParsedCommandFlags`-based reconstruction for diverse input command strings (manual test or add test in `command_flags.rs` tests).

- Location: `src-tauri/src/render.rs`
- Description: Delete `extract_filter_paths` function (lines 10-30). Delete `remove_filter_flags` function (lines 32-87). Delete their 5 `#[test]` functions (lines 167-213). Remove the now-unused `use` lines if applicable.
- Dependencies: Phase 2 `list_filters` and `toggle_filters` rewritten.
- Acceptance criteria: `cargo check` succeeds. `cargo test` passes (the deleted tests are gone, other tests unaffected).
- Validation: `cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`

### Phase 3: Eliminate TS-side parseCommand

Goal: `SettingsDialog.tsx` receives structured flags from Rust's `get_config` response and no longer calls `parseCommand`. `parseCommand` is removed from `command-parser.ts`. `buildCommand` is kept.

Tasks:

- Location: `src/shared/command-parser.ts`
- Description: Remove `parseCommand` function (lines 51-136) and all its helper types/functions that are only used by it: `ParsedFlags` interface (lines 8-19), `MinimistOutput` interface (lines 21-37), `tokenize` function (lines 4-6) if not used elsewhere, `lastOf`/`allOf` helpers (lines 39-49), `knownFlags` set. Keep: `buildCommand` (lines 138-174) and its imports (`quote` from `shell-quote`). Remove `parse` import from `shell-quote` and `minimist` import if no longer needed. Add a `ParsedFlags` type that matches the Rust `ParsedCommandFlags` serialization shape (for `buildCommand` parameter typing).
- Dependencies: Phase 2 complete (Rust side sends structured flags).
- Acceptance criteria: `just typecheck` passes. No imports of `parseCommand` anywhere in TS code.
- Validation: `just typecheck`

- Location: `src/client/components/SettingsDialog.tsx`
- Description: Change `SettingsData` interface to include `parsedFlags: ParsedFlags` field. Replace `const parsedFlags = useMemo(() => parseFlags(rawArgsText), [rawArgsText])` with state from `get_config` response: `const [parsedFlags, setParsedFlags] = useState<ParsedFlags>({...defaults})`. In the `useEffect` that fetches config: `setParsedFlags(data.parsedFlags || {...defaults})`. When the user modifies a flag via `updateFlag`, apply the patch locally and also call `buildCommand` to update `rawArgsText` (same as current behavior). When the user modifies `rawArgsText` directly, we need to handle this — two options:
  - Option A: Send raw text to backend, get back parsed flags (round-trip through Rust on every keystroke — too slow)
  - Option B: Keep a minimal TS-side fallback parser for the raw-text-editing case, or accept that structured controls lag when editing raw text
  - Decision: Keep a lightweight TS-side parse for the raw-text-editing path, but scope it to ONLY the flags used by structured controls (same set as Rust `ParsedCommandFlags`) and make `buildCommand`/`parseCommand` use the SAME tokenizer (`shell-quote`). Since we're deleting `parseCommand` which uses `minimist`, we can write a minimal TS parser that mirrors the Rust parser (using `shell-quote` only, no minimist).
  
  Actually, looking at this more carefully: the current UX is that editing the raw textarea immediately updates the structured controls via `useMemo(() => parseFlags(rawArgsText), [rawArgsText])`. This is a client-side-only operation - no server round-trip. If we eliminate TS-side parsing entirely, we lose this responsive behavior.

  Revised approach: Instead of eliminating `parseCommand` entirely, replace it with a minimal TS parser that:
  1. Uses `shell-quote` only (same tokenizer as `shell_words` on Rust side)
  2. Parses only the flag subset present in `ParsedCommandFlags`
  3. Is kept in the same file as `buildCommand`
  
  The key win is: ONE tokenization strategy (`shell_words`/`shell-quote`), not the scattered `shell_words` + `minimist` + manual scanning mess. And the Rust side no longer re-parses ad-hoc.

  Wait, but the user's existential question was: "when you could parse it ONCE on the Rust side, maintain the structured representation, and send the parsed flags to the client?" That implies the client shouldn't parse at all.

  Let me reconsider. The purpose of the TS parse is to update structured controls in real-time when the user edits the raw textarea. If we eliminate this, the structured controls go stale while the user types in raw mode, and only update on save. That's a UX regression.

  But the user explicitly asked for parsing once on the Rust side. So let's do that: on initial load, `get_config` sends parsed flags, and the TS side uses them to populate structured controls. When the user edits structured controls, `buildCommand` reconstructs the raw string. When the user edits the raw textarea directly, structured controls do NOT update in real-time — they only update after `set_config` (save). The raw text tab is the authoritative view anyway.

  This means: TS `parseCommand` is deleted entirely. The raw-text-editing path does not trigger re-parsing on the client. The structured controls reflect the last-saved state, not the in-progress raw edit. This is acceptable UX because the raw command tab explicitly says "Changes in raw arguments automatically update the options checkboxes, and vice-versa" — we change this to say "Edit flags using the structured controls, or paste a complete command in Raw Command and save."

  Update:
  - Remove the `useMemo(() => parseFlags(rawArgsText), [rawArgsText])` line
  - `parsedFlags` is initialized from `get_config().parsedFlags`
  - `updateFlag` still works: patch + `buildCommand` → update `rawArgsText`
  - Raw textarea edits update `rawArgsText` but NOT `parsedFlags` (re-sync happens on next dialog open via `get_config`)
  - Change the help text below raw textarea to reflect this

- Dependencies: Phase 2 complete. `get_config` returns `parsedFlags`.
- Acceptance criteria: Settings dialog opens with correct structured controls populated from Rust's parsed flags. Toggling filters/checkboxes updates the raw command text correctly. Saving persists changes. No `parseCommand` import exists.
- Validation: `just typecheck`. Manual testing in `just run`.

- Location: `src/client/components/SettingsDialog.tsx` 
- Description: Update the `SettingsData` interface to match the new `get_config` response shape.
- Dependencies: Phase 1 `get_config` change.
- Acceptance criteria: TS compiles with the new interface.
- Validation: `just typecheck`

### Phase 4: Add round-trip integration test

Goal: Prove `buildCommand(parse(X)) = X` and `reconstruct_command(parse_render_command(X)) = X` for representative command strings.

Tasks:

- Location: `src-tauri/src/command_flags.rs` (tests module)
- Description: Add `#[test] fn round_trip_filter_flags()` — parses command with filters, reconstructs, asserts equality. Add `#[test] fn round_trip_all_flags()` — command with standalone/citeproc/toc/math/template/filters/other, round-trips. Add `#[test] fn round_trip_empty()` — just `"pandoc"`, round-trips.
- Dependencies: `parse_render_command` and `reconstruct_command` exist.
- Acceptance criteria: All test inputs round-trip to identical strings.
- Validation: `cargo test --manifest-path src-tauri/Cargo.toml`

## System-Level Validation

- End-to-end checks:
  1. `cargo test --manifest-path src-tauri/Cargo.toml` — all Rust tests pass
  2. `just typecheck` — TS compiles clean
  3. `just run` — app launches, Settings dialog opens, structured controls populated from command, filter toggles modify raw text, save persists to config.toml, reopen dialog shows saved state
- Real-use smoke checks:
  1. Round-trip a complex command through `buildCommand(data.parsedFlags)` → `set_config` → `get_config` → verify `parsedFlags` matches original
  2. Edit raw command to add a filter, save, reopen Settings — filter appears in structured list
  3. Toggle a filter off in structured controls, save — verify config.toml no longer contains that filter flag

## Risks / Rollback

- Risks: 
  - TS `parseCommand` removed but structured controls need initial state — mitigated by Rust sending `parsedFlags` in `get_config`
  - Raw textarea edits no longer update structured controls in real-time — this is a deliberate UX change; the help text is updated to set expectations
  - `toggle_filters` behavioral change — mitigated by verifying equivalent output for same inputs before committing
- Mitigations: All changes are gated behind plan approval. Each phase has independent `cargo check` validation. Git checkpoints before each phase.
- Rollback path: `git stash` the worktree branch. All changes are in a single branch with atomic commits per phase.

## Stop Rules

- Do not proceed if `cargo test` fails at any phase boundary.
- Do not proceed if `just typecheck` fails in Phase 3.
- Do not proceed to Phase 2 until Phase 1 `get_config` response shape is verified to include `parsedFlags`.
- Do not delete `extract_filter_paths`/`remove_filter_flags` until `list_filters`/`toggle_filters` are rewritten and verified.

## Execution Progress

### Prerequisites

- [x] Access requirements met
- [x] Environment configured
- [x] External dependencies resolved

### Phase 0: Add structured flags type + single Rust parser

- [x] Task 0.1: Create `src-tauri/src/command_flags.rs` with `ParsedCommandFlags` + `parse_render_command` + `reconstruct_command` + tests
- [x] Task 0.2: Add `pub mod command_flags;` to `src-tauri/src/lib.rs`

### Phase 1: Wire structured flags into AppState + config flow

- [x] Task 1.1: Add `parsed_flags` field to `AppState` in `state.rs`
- [x] Task 1.2: Parse command in `build_initial_state` in `config.rs`
- [x] Task 1.3: Re-parse command in `set_config` in `commands/config.rs`
- [x] Task 1.4: Return `parsedFlags` in `get_config` response

### Phase 2: Migrate Rust consumers to use AppState.parsed_flags

- [x] Task 2.1: Rewrite `list_filters` to read from `s.parsed_flags`
- [x] Task 2.2: Rewrite `toggle_filters` to modify `s.parsed_flags` and reconstruct
- [x] Task 2.3: Delete `extract_filter_paths`, `remove_filter_flags`, and their tests from `render.rs`

### Phase 3: Eliminate TS-side parseCommand

- [x] Task 3.1: Remove `parseCommand` from `command-parser.ts`, keep `buildCommand`
- [x] Task 3.2: Update `SettingsDialog.tsx` to use `get_config().parsedFlags` instead of `parseCommand`
- [x] Task 3.3: Update raw textarea help text

### Phase 4: Add round-trip integration test

- [x] Task 4.1: Add round-trip tests to `command_flags.rs` tests module (7 round-trip tests: basic, filters, template, math, all-flags, quoted-paths, has-filter-with-path)

### System-Level Validation

- [x] `cargo test` passes (48 of 48)
- [x] `just typecheck` passes (zero errors)
- [ ] Manual smoke test in `just run` (requires GUI)
