#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/warm-down/NoxuOS.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/NoxuOS}"
APP_DIR="${APP_DIR:-$INSTALL_DIR/agent-workflow-app}"
SERVICE_NAME="${SERVICE_NAME:-noxuos-agent-worker.service}"
PI_ADDRESS="${PI_ADDRESS:-192.168.1.243}"
DEVICE_NAME="${DEVICE_NAME:-$(hostname)}"
DEVICE_ROLE="${DEVICE_ROLE:-worker}"
AI_PROVIDER="${AI_PROVIDER:-ollama}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:latest}"

set_env() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

require_user_service() {
  if [[ "$(id -u)" -eq 0 ]]; then
    echo "Run this as the target user, not root. The script uses sudo only for systemd install."
    exit 1
  fi
}

ensure_repo() {
  if [[ ! -d "$INSTALL_DIR/.git" ]]; then
    git clone "$REPO_URL" "$INSTALL_DIR"
  else
    git -C "$INSTALL_DIR" pull --ff-only
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    local major
    major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
    if [[ "$major" -ge 18 ]]; then
      echo "Node ready: $(node --version)"
      return
    fi
  fi

  echo "Installing Node.js..."
  sudo apt update
  sudo apt install -y curl ca-certificates nodejs npm

  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  if [[ "$major" -lt 18 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
  fi
}

configure_env() {
  cd "$APP_DIR"

  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      cp .env.example .env
    else
      touch .env
    fi
  fi

  set_env .env AI_PROVIDER "$AI_PROVIDER"
  set_env .env OLLAMA_BASE_URL http://127.0.0.1:11434
  set_env .env OLLAMA_MODEL "$OLLAMA_MODEL"
  set_env .env DEVICE_NAME "$DEVICE_NAME"
  set_env .env DEVICE_ROLE "$DEVICE_ROLE"
  set_env .env PI_HOST "http://${PI_ADDRESS}:5000"
  set_env .env EMPIRE_WS "ws://${PI_ADDRESS}:8765"
  set_env .env SECURITY_NODE_NAME "${SECURITY_NODE_NAME:-Kali-XPS-Security}"
  set_env .env CAMERA_SCAN_SUBNET "${CAMERA_SCAN_SUBNET:-192.168.1.0/24}"
  set_env .env CAMERA_SCAN_ALLOWED_SUBNETS "${CAMERA_SCAN_ALLOWED_SUBNETS:-192.168.1.0/24}"
  set_env .env CAMERA_SCAN_PORTS "${CAMERA_SCAN_PORTS:-80,443,554,8080,8888}"

  npm install
}

install_service() {
  local node_path
  local npm_path
  local user_name

  node_path="$(command -v node)"
  npm_path="$(command -v npm)"
  user_name="$(id -un)"

  sudo tee "/etc/systemd/system/$SERVICE_NAME" >/dev/null <<EOF
[Unit]
Description=NoxuOS Agent Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$user_name
WorkingDirectory=$APP_DIR
Environment=PATH=$(dirname "$node_path"):$(dirname "$npm_path"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$npm_path run worker
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
}

main() {
  require_user_service

  sudo apt update
  sudo apt install -y git curl ca-certificates

  ensure_repo
  ensure_node
  configure_env
  install_service

  echo
  echo "Service status:"
  sudo systemctl --no-pager --full status "$SERVICE_NAME" || true

  echo
  echo "Mesh check:"
  cd "$APP_DIR"
  npm run bridge:check

  echo
  echo "Worker installed. Logs:"
  echo "  sudo journalctl -u $SERVICE_NAME -f"
}

main "$@"
