# QC Baseline and Rust Fail-Fast Enforcement Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Establish a baseline for project QC by marking completed tasks and implementing global Rust fail-fast rules to detect silenced Result errors.

**Architecture:** Use Semgrep in the global Quality Control system to detect `let _ =` on Rust expressions, then propagate this check to the project.

**Tech Stack:** Semgrep, Justfile, Rust.

---

### Task 1: Mark completed documentation and verification tasks in TODO.md

**Objective:** Synchronize `TODO.md` with existing evidence in `.agents/memories/` and `.agents/audits/`.

**Files:**
- Modify: `TODO.md`

**Step 1: Identify completed items**
- [x] Document failed-test debugging protocol (verified: `.agents/memories/decisions/failed-test-debugging-protocol.md`)
- [x] Document banned E2E patterns and current failures (verified: `.agents/audits/banned-patterns-general.md`, `.agents/audits/current-failures.md`)
- [x] Repair non-admissible migrated tests (verified: audit shows zero @ts-nocheck, require, etc.)

**Step 2: Update TODO.md**
Update the file to reflect these completions.

**Step 3: Commit**
```bash
git add TODO.md
git commit -m "docs: sync TODO.md with existing verification artifacts"
```

---

### Task 2: Add Rust semgrep rule to Global QC

**Objective:** Add a rule to catch silenced Result assignments in Rust.

**Files:**
- Modify: `/home/dzack/ai/quality-control/semgrep.yml`

**Step 1: Add rule definition**
```yaml
  - id: rust-silenced-result
    pattern: let _ = $EXPR;
    message: |
      Using `let _ =` to silence a `Result` (or any must_use type) is a fail-fast violation.
      Handle the error explicitly with `?`, `unwrap()`, `expect()`, or pattern matching.
    languages: [rust]
    severity: ERROR
```

**Step 2: Verify rule syntax**
Run: `semgrep --validate --config /home/dzack/ai/quality-control/semgrep.yml`

**Step 3: Commit**
```bash
(cd ~/ai/quality-control && git add semgrep.yml && git commit -m "feat(rust): add rule to detect silenced Result assignments")
```

---

### Task 3: Include Rust files in Global QC semgrep analysis

**Objective:** Update the global QC justfile to include Rust files when running semgrep.

**Files:**
- Modify: `/home/dzack/ai/quality-control/justfile`

**Step 1: Update _semgrep recipe**
Update `python_files` logic to include `.rs` files or generalize it.

**Step 2: Verify**
Run `just -f ~/ai/quality-control/justfile _semgrep` in a project with Rust files.

**Step 3: Commit**
```bash
(cd ~/ai/quality-control && git add justfile && git commit -m "build(qc): include rust files in semgrep analysis")
```

---

### Task 4: Project-Local Semgrep Integration

**Objective:** Ensure the project runs the new semgrep rule during `just test`.

**Files:**
- Create: `semgrep.yml`
- Modify: `justfile`

**Step 1: Create local semgrep.yml**
It should extend the global one:
```yaml
extends:
  - /home/dzack/ai/quality-control/semgrep.yml
```

**Step 2: Update project justfile**
Add `_semgrep` call to `test` recipe.

**Step 3: Verify**
Run `just test`.

**Step 4: Commit**
```bash
git add semgrep.yml justfile
git commit -m "build(qc): integrate global semgrep rules into project test gate"
```
