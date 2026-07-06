#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/warm-down/NoxuOS.git}"
INSTALL_DIR="${INSTALL_DIR:-/home/pi/NoxuOS}"
SERVICE_NAME="empire-pi.service"

echo "== NoxuOS Pi Controller Installer =="

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this script as the pi user, not root."
  exit 1
fi

sudo apt update
sudo apt install -y python3-pip git curl

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  git clone "$REPO_URL" "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" pull --ff-only
fi

cd "$INSTALL_DIR/pi-controller"
python3 -m pip install --user --break-system-packages -r requirements.txt \
  || python3 -m pip install --user -r requirements.txt

sudo install -m 0644 "$INSTALL_DIR/pi-controller/$SERVICE_NAME" "/etc/systemd/system/$SERVICE_NAME"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo
echo "Service status:"
sudo systemctl --no-pager --full status "$SERVICE_NAME" || true

echo
echo "Health checks:"
echo "  curl http://localhost:5000/devices"
echo "  curl http://localhost:5000/health"
echo "  curl http://localhost:5000/bus/clients"
echo "  curl http://pi5.local:5000/devices"
