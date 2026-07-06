#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-esphome-dashboard.service}"
ESPHOME_PORT="${ESPHOME_PORT:-6052}"
ESPHOME_CONFIG_DIR="${ESPHOME_CONFIG_DIR:-$HOME/esphome}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this as the pi user, not root."
  exit 1
fi

echo "== NoxuOS Pi Home Automation Bootstrap =="

sudo apt update
sudo apt install -y mosquitto mosquitto-clients python3-pip python3-venv curl

sudo systemctl enable mosquitto
sudo systemctl restart mosquitto

python3 -m pip install --user --break-system-packages -U esphome \
  || python3 -m pip install --user -U esphome

mkdir -p "$ESPHOME_CONFIG_DIR"

ESPHOME_BIN="$HOME/.local/bin/esphome"
if [[ ! -x "$ESPHOME_BIN" ]]; then
  ESPHOME_BIN="$(command -v esphome)"
fi

sudo tee "/etc/systemd/system/$SERVICE_NAME" >/dev/null <<EOF
[Unit]
Description=ESPHome Dashboard
After=network-online.target mosquitto.service
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$ESPHOME_CONFIG_DIR
ExecStart=$ESPHOME_BIN dashboard $ESPHOME_CONFIG_DIR --address 0.0.0.0 --port $ESPHOME_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo
echo "MQTT:"
systemctl is-active mosquitto
mosquitto_pub -h 127.0.0.1 -t noxuos/health -m online

echo
echo "ESPHome dashboard:"
systemctl is-active "$SERVICE_NAME"
echo "  http://$(hostname -I | awk '{print $1}'):$ESPHOME_PORT"

echo
echo "Note: Home Assistant itself is still a separate service/device."
echo "Point NoxuOS HOME_ASSISTANT_URL at your Home Assistant instance when it exists."
