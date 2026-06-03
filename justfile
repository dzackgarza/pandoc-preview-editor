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

# Run all tests: Rust unit tests + Playwright E2E (browser smoke + Tauri desktop proofs)
test: _agent-contracts _typecheck
    cargo test --manifest-path src-tauri/Cargo.toml
    npx playwright test --config src/tests/playwright.config.ts

[private]
_test-rust:
    cargo test --manifest-path src-tauri/Cargo.toml

[private]
_test-rust-verbose:
    cargo test --manifest-path src-tauri/Cargo.toml -- --show-output
