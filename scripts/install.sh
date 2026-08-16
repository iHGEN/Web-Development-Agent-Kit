#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${1:-.}"
python3 "$SCRIPT_DIR/agent-kit.py" install "$PROJECT"
python3 "$SCRIPT_DIR/project_profile.py" "$PROJECT"
