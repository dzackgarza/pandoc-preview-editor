#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
original_home="${HOME:-$script_dir/home}"
export HOME="${PANDOC_PREVIEW_TEST_HOME:-$original_home}"
export CARGO_HOME="${CARGO_HOME:-$original_home/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$original_home/.rustup}"
export XDG_CONFIG_HOME="${PANDOC_PREVIEW_TEST_XDG_CONFIG_HOME:-${XDG_CONFIG_HOME:-$script_dir/xdg-config}}"
export XDG_STATE_HOME="${PANDOC_PREVIEW_TEST_XDG_STATE_HOME:-${XDG_STATE_HOME:-$script_dir/xdg-state}}"

# The tauri-playwright adapter spawns this script and sends SIGTERM on teardown.
# But `npx tauri dev` does NOT propagate signals to its children (cargo, the
# Tauri binary). The GUI window (grandchild) survives as an orphan.
#
# Fix: run `npx tauri dev` as a background job with job control enabled (`set -m`),
# which places the child in its own process group. When Playwright sends SIGTERM
# to this script's PID, the EXIT trap fires and kills the child's entire process
# group (npx → cargo → Tauri binary).

child_pid=""

kill_tree() {
  if [ -n "$child_pid" ]; then
    # Kill the child's entire process group (negative PID = group kill).
    kill -- -"$child_pid" 2>/dev/null || true
    # Fallback: kill just the direct child.
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
}

trap kill_tree EXIT
set -m

npx tauri dev --config "$script_dir/tauri.e2e.conf.json" --no-watch "$@" &
child_pid=$!

# Wait for the Tauri process. When Playwright sends SIGTERM to this script,
# the EXIT trap fires, killing the entire child process group before exiting.
wait "$child_pid"