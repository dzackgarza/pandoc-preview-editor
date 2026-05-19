# justfile for pandoc-preview

set quiet := false

# Install dependencies
install:
    npm install

# Run the app (optional file argument via FILE)
run file='':
    #!/usr/bin/env bash
    set -euo pipefail
    cmd="npx tsx src/server/cli.ts"
    if [ -n "{{file}}" ]; then
        cmd="$cmd {{file}}"
    fi
    exec $cmd

[private]
_typecheck:
    npx tsc --noEmit
