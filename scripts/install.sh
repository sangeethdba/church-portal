#!/usr/bin/env bash
# Install deps in a way Freebuff's preview shell can find the binary.
# See scripts/preview.sh for the rationale.

set -euo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
cd "$(cd "$(dirname "$0")/.." && pwd)"
exec npm install
