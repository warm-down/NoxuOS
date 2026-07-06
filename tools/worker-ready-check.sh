#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/warm-down/NoxuOS.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/NoxuOS}"
APP_DIR="${APP_DIR:-$INSTALL_DIR/agent-workflow-app}"
SERVICE_NAME="${SERVICE_NAME:-noxuos-agent-worker.service}"
PI_ADDRESS="${PI_ADDRESS:-192.168.1.243}"
DEVICE_NAME="${DEVICE_NAME:-$(hostname)}"
DEVICE_ROLE="${DEVICE_ROLE:-worker}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this as the target user, not root."
  exit 1
fi

echo "== NoxuOS Worker Ready Check =="
echo "Device: $DEVICE_NAME ($DEVICE_ROLE)"
echo "Pi: $PI_ADDRESS"

sudo apt update
sudo apt install -y git curl ca-certificates

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" pull --ff-only
fi

cd "$INSTALL_DIR"
PI_ADDRESS="$PI_ADDRESS" \
DEVICE_NAME="$DEVICE_NAME" \
DEVICE_ROLE="$DEVICE_ROLE" \
./tools/install-agent-worker-service.sh

echo
echo "Service:"
systemctl is-active "$SERVICE_NAME"

echo
echo "Bridge check:"
cd "$APP_DIR"
npm run bridge:check

echo
echo "Pi registry:"
curl -fsS "http://${PI_ADDRESS}:5000/devices"
echo

echo
echo "Pi active bus clients:"
if curl -fsS "http://${PI_ADDRESS}:5000/bus/clients"; then
  echo
else
  echo "Pi controller needs git pull + restart for /bus/clients."
fi

echo
echo "Recent worker logs:"
sudo journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true

echo
echo "Worker ready check complete."
