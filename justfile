# justfile for pandoc-nvim-preview

set quiet := false

# Install dependencies
install:
    npm install

# Build web frontend bundle
build:
    bun build web/main.ts --outdir=web/dist --target=browser

# Clean runtime state (sockets, temp dirs, processes) — run before tests
clean-runtime:
    -fuser -k 3141/tcp
    -killall -9 nvim
    -killall -9 node
    -rm -rf /tmp/pandoc-nvim-preview

# Clean build artifacts
clean:
    rm -rf dist web/dist node_modules
    just clean-runtime

# Run Playwright E2E tests (provisions/decommissions server via webServer config)
test: build clean-runtime
    npx playwright test

# Run Playwright tests in headed mode
test-ui: build clean-runtime
    npx playwright test --ui

# Run proof ladder tests (no webServer — each test launches its own)
test-ladder: build clean-runtime
    npx playwright test --config=playwright.ladder.config.ts

# Run certification tests with witness traces
test-cert: build clean-runtime
    npx playwright test --config=playwright.cert.config.ts

# Type-check project
typecheck:
    npx tsc --noEmit

# Full setup: install + build + typecheck
setup: install build typecheck

# Start dev server (watches and rebuilds)
dev file='notes.md':
    bun build web/main.ts --outdir=web/dist --target=browser --watch &
    npx tsx server/index.ts {{file}}
