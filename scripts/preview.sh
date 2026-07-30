#!/usr/bin/env bash
# Run the Vite dev server in a way Freebuff's preview shell can find the binary.
# freebuff-preview assembles the registered command on a single shell line, so
# any command string with spaces is interpreted as a single executable name
# by sh. This wrapper is itself a single-token command (`bash scripts/preview.sh`),
# and bash then runs the real dev server with its own PATH/env.

set -euo pipefail

# Make sure common install locations are on PATH inside the preview sandbox.
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Always run from the repo root (alongside package.json and vite.config.ts).
cd "$(cd "$(dirname "$0")/.." && pwd)"

# Run Vite via the package.json script — this honors $PORT injected by Freebuff
# (vite.config.ts already binds 0.0.0.0).
exec npm run dev
