#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export REPO_URL="${REPO_URL:-https://github.com/Upsonic/Upsonic.git}"
export INSTALL_DIR="${INSTALL_DIR:-$HOME/Upsonic}"
export REMOTE_INSTALL_DIR="${REMOTE_INSTALL_DIR:-~/Upsonic}"

exec "$SCRIPT_DIR/sync-git-repo-nodes.sh" "$@"
