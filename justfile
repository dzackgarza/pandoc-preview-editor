# justfile for pandoc-preview

set quiet := false

# Install dependencies
install:
    npm install

# Set up the project, install dependencies, build client, and initialize default config
setup: install build-client
    #!/usr/bin/env bash
    set -euo pipefail
    XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
    TARGET_DIR="$XDG_CONFIG_HOME/pandoc-preview"
    TARGET_FILE="$TARGET_DIR/config.toml"
    if [ ! -f "$TARGET_FILE" ] && [ ! -f "$TARGET_DIR/pandoc-preview.toml" ]; then
        mkdir -p "$TARGET_DIR"
        echo "[render]" > "$TARGET_FILE"
        echo "debounce_ms = 750" >> "$TARGET_FILE"
        echo "timeout_ms = 30000" >> "$TARGET_FILE"
        echo "" >> "$TARGET_FILE"
        echo "[pandoc]" >> "$TARGET_FILE"
        echo "render_command = \"pandoc --standalone --citeproc --mathjax --template=~/.pandoc/templates/pandoc_preview_template.html --lua-filter=~/.pandoc/filters/tikzcd.lua --lua-filter=~/.pandoc/filters/convert_amsthm_envs.lua -f markdown+tex_math_dollars+citations+wikilinks_title_after_pipe+tex_math_single_backslash -t html\"" >> "$TARGET_FILE"
        echo "templates_dir = \"~/.pandoc/templates\"" >> "$TARGET_FILE"
        echo "filters_dir = \"~/.pandoc/filters\"" >> "$TARGET_FILE"
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

# Type-check the project
typecheck:
    npx tsc --noEmit

# Run all Rust unit tests
test:
    cargo test --manifest-path src-tauri/Cargo.toml

# Run Rust tests with output
test-verbose:
    cargo test --manifest-path src-tauri/Cargo.toml -- --show-output
