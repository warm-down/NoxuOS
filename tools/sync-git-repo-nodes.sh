#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:?Set REPO_URL, for example https://github.com/Upsonic/Upsonic.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/$(basename "$REPO_URL" .git)}"
NODES="${NODES:-}"
REMOTE_INSTALL_DIR="${REMOTE_INSTALL_DIR:-}"

repo_name() {
  basename "$REPO_URL" .git
}

ensure_local_repo() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "[LOCAL] Pulling $INSTALL_DIR"
    git -C "$INSTALL_DIR" pull --ff-only
    return
  fi

  echo "[LOCAL] Cloning $REPO_URL -> $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
}

sync_node() {
  local node="$1"
  [[ -z "$node" ]] && return

  local remote_dir="${REMOTE_INSTALL_DIR:-~/$(repo_name)}"

  echo
  echo "[REMOTE] $node -> $remote_dir"
  ssh "$node" "set -e; \
    if [ -d $remote_dir/.git ]; then \
      git -C $remote_dir pull --ff-only; \
    else \
      git clone $REPO_URL $remote_dir; \
    fi; \
    cd $remote_dir; \
    git log -1 --oneline"
}

main() {
  echo "== Git Repo Node Sync =="
  echo "Repo: $REPO_URL"
  echo "Local: $INSTALL_DIR"
  echo "Nodes: ${NODES:-none}"
  echo

  ensure_local_repo

  if [[ -n "$NODES" ]]; then
    IFS=',' read -ra node_list <<<"$NODES"
    for node in "${node_list[@]}"; do
      node="$(echo "$node" | xargs)"
      sync_node "$node"
    done
  fi

  echo
  echo "Sync complete."
  echo "Note: Home Assistant OS appliances are intentionally not git clone targets."
}

main "$@"
