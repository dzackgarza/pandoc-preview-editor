# justfile for pandoc-preview

set quiet := false

# Install dependencies
install:
    npm install

# Set up the project, install dependencies, build client, and initialize default config
setup: install build-client
    #!/usr/bin/env bash
    set -euo pipefail
    git config core.hooksPath .githooks
    XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
    TARGET_DIR="$XDG_CONFIG_HOME/pandoc-preview"
    TARGET_FILE="$TARGET_DIR/config.toml"
    if [ ! -f "$TARGET_FILE" ] && [ ! -f "$TARGET_DIR/pandoc-preview.toml" ]; then
        mkdir -p "$TARGET_DIR"
        cp default-config.toml "$TARGET_FILE"
        echo "Initialized default configuration at: $TARGET_FILE"
    else
        echo "Configuration already exists, skipping initialization."
    fi


# Build the React client
build-client:
    npx vite build

# Run the app in development mode
run:
    npx tauri dev

# Build the Tauri desktop application (.deb / AppImage)
build-tauri:
    npx tauri build

[private]
_agent-contracts:
    node scripts/check-agent-contracts.mjs --all

[private]
_agent-contracts-staged:
    node scripts/check-agent-contracts.mjs --staged

[private]
_typecheck:
    npx tsc --noEmit

[private]
_check-dependencies:
    #!/usr/bin/env bash
    set -euo pipefail
    missing=()
    for tool in pandoc qtikz tikzit inkscape xournal xournalpp ipe; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            missing+=("$tool")
        fi
    done
    
    # Special case for drawio/draw.io
    if ! command -v drawio >/dev/null 2>&1 && ! command -v draw.io >/dev/null 2>&1; then
        missing+=("drawio (or draw.io)")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        echo "FATAL: Missing hard dependencies required for pandoc-preview startup:"
        for m in "${missing[@]}"; do
            echo "  - $m"
        done
        echo "The app is architected to fail-fast and will panic (101) if any of these are missing from PATH."
        exit 1
    fi

# Run all tests: agent contracts, type-check, Rust unit tests, canonical workflow E2E.
test: _agent-contracts _typecheck
    #!/usr/bin/env bash
    set -euo pipefail

    # Provision dummy binaries for missing hard dependencies to satisfy probe_tool_state panic
    bin_dir="$(pwd)/.agents/tmp/bin"
    mkdir -p "$bin_dir"
    for tool in qtikz tikzit inkscape drawio draw.io xournal xournalpp ipe; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            printf "#!/bin/sh\nexit 0\n" > "$bin_dir/$tool"
            chmod +x "$bin_dir/$tool"
        fi
    done
    export PATH="$bin_dir:$PATH"

    # Assert existence of all required tools
    missing=()
    for tool in pandoc qtikz tikzit inkscape xournal xournalpp ipe; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            missing+=("$tool")
        fi
    done
    if ! command -v drawio >/dev/null 2>&1 && ! command -v draw.io >/dev/null 2>&1; then
        missing+=("drawio (or draw.io)")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        echo "FATAL: Dependency check failed even after provisioning dummies:"
        for m in "${missing[@]}"; do
            echo "  - $m"
        done
        exit 1
    fi

    test_target_dir="$(pwd)/.agents/tmp/cargo-target"
    export CARGO_TARGET_DIR="$test_target_dir"

    cleanup() {
        status="$?"
        cleanup_status=0

        cargo clean --manifest-path src-tauri/Cargo.toml --target-dir "$test_target_dir" || cleanup_status="$?"

        if [ "$status" -eq 0 ]; then
            if [ -e test-results ]; then
                gio trash test-results
            fi
            if [ -e tauri-dev.log ]; then
                gio trash tauri-dev.log
            fi
        fi

        if [ "$cleanup_status" -ne 0 ]; then
            exit "$cleanup_status"
        fi
        exit "$status"
    }

    terminate() {
        exit 143
    }

    trap cleanup EXIT
    trap terminate INT TERM

    # Clean stale socket
    rm -f /tmp/tauri-playwright.sock

    mkdir -p "$test_target_dir"
    cargo test --manifest-path src-tauri/Cargo.toml
    # Pre-compile dev build to avoid Playwright timeout
    cargo build --manifest-path src-tauri/Cargo.toml
    npx playwright test --config src/tests/playwright.config.ts --max-failures=1

[private]
_test-rust:
    cargo test --manifest-path src-tauri/Cargo.toml

[private]
_test-rust-verbose:
    cargo test --manifest-path src-tauri/Cargo.toml -- --show-output
