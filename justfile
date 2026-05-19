# justfile for pandoc-nvim-preview

set quiet := false

# Install dependencies
install:
    npm install

# Run Playwright tests; tests launch and stop their own CLI processes
test *args: _build
    npx playwright test {{args}}

# Run the app
run file='notes.md':
    #!/usr/bin/env bash
    set -euo pipefail
    just _watch &
    build_pid=$!
    trap 'kill "$build_pid" 2>/dev/null || true' EXIT INT TERM
    npx tsx server/cli.ts {{file}}

[private]
_build:
    bun build web/main.ts --outdir=web/dist --target=browser

[private]
_watch:
    bun build web/main.ts --outdir=web/dist --target=browser --watch

[private]
_clean:
    rm -rf dist web/dist

[private]
_test-ui: _build
    npx playwright test --ui

[private]
_test-ladder: _build
    npx playwright test --config=playwright.ladder.config.ts

[private]
_test-cert: _build
    npx playwright test --config=playwright.cert.config.ts

[private]
_typecheck:
    npx tsc --noEmit

[private]
_install-plugin:
    mkdir -p ~/.config/nvim/plugin
    cp nvim/plugin/pandoc-preview.lua ~/.config/nvim/plugin/pandoc-preview.lua
    @echo "Installed nvim/plugin/pandoc-preview.lua -> ~/.config/nvim/plugin/pandoc-preview.lua"

[private]
_setup: install _build _typecheck
