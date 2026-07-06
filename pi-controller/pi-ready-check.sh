#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/warm-down/NoxuOS.git}"
INSTALL_DIR="${INSTALL_DIR:-/home/pi/NoxuOS}"
SERVICE_NAME="empire-pi.service"

echo "== NoxuOS Pi Ready Check =="

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this script as the pi user, not root."
  exit 1
fi

sudo apt update
sudo apt install -y curl git python3 python3-pip

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" pull --ff-only
fi

cd "$INSTALL_DIR/pi-controller"

python3 -m pip install --user --break-system-packages -r requirements.txt \
  || python3 -m pip install --user -r requirements.txt

sudo install -m 0644 "$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

sleep 2

echo
echo "Service:"
systemctl is-active "$SERVICE_NAME"

echo
echo "HTTP devices:"
curl -fsS http://localhost:5000/devices
echo

echo
echo "WebSocket port:"
python3 - <<'PY'
import socket

with socket.create_connection(("127.0.0.1", 8765), timeout=3):
    print("open")
PY

echo
echo "Pi addresses:"
hostname -I

echo
echo "Ready. From Windows, open:"
echo "  http://pi5.local:5000/devices"
