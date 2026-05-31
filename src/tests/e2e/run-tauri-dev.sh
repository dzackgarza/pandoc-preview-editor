#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export XDG_CONFIG_HOME="$script_dir/xdg-config"
exec npx tauri dev "$@"
