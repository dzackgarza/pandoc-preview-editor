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

# Run all tests: agent contracts, type-check, Rust unit tests, canonical workflow E2E.
test: _agent-contracts _typecheck
    #!/usr/bin/env bash
    set -euo pipefail

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

    mkdir -p "$test_target_dir"
    cargo test --manifest-path src-tauri/Cargo.toml
    npx playwright test --config src/tests/playwright.config.ts --max-failures=1

[private]
_test-rust:
    cargo test --manifest-path src-tauri/Cargo.toml

[private]
_test-rust-verbose:
    cargo test --manifest-path src-tauri/Cargo.toml -- --show-output
