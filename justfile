# justfile for pandoc-preview

set quiet := false

# Install dependencies
install:
    npm install

# Build the React client
build-client:
    npx vite build

# Run the app (optional file argument via FILE)
run file='': build-client
    #!/usr/bin/env bash
    set -euo pipefail
    cmd="npx tsx src/server/cli.ts"
    if [ -n "{{file}}" ]; then
        cmd="$cmd {{file}}"
    fi
    exec $cmd

# Type-check the project
typecheck:
    npx tsc --noEmit

# Run all tests (Playwright E2E + API tests)
test: build-client
    npx playwright test

# Run tests in headed mode (visible browser)
test-headed: build-client
    npx playwright test --headed

# Run tests with HTML reporter
test-report: build-client
    npx playwright test --reporter=html

# Run only API-level render tests (no browser needed)
test-render:
    npx playwright test src/tests/render.spec.ts

# Run only browser E2E tests
test-e2e: build-client
    npx playwright test src/tests/e2e.spec.ts

# Run only file workflow tests
test-file filter='': build-client
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "{{filter}}" ]; then
        npx playwright test src/tests/file.spec.ts --grep "{{filter}}"
    else
        npx playwright test src/tests/file.spec.ts
    fi
