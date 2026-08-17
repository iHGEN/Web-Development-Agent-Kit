#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo "Node.js and npm/npx are required to install Web Development Agent Kit." >&2
  exit 1
fi

exec npx --yes @ihgen/web-kit install "$@"
