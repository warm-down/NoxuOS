#!/usr/bin/env bash
set -euo pipefail

ESPHOME_DIR="${ESPHOME_DIR:-/opt/esphome}"
ESPHOME_PORT="${ESPHOME_PORT:-6052}"
MQTT_PORT="${MQTT_PORT:-1883}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as the pi user. The script uses sudo where needed."
  exit 1
fi

echo "== NoxuOS Pi 5 Automation Services =="
echo "MQTT port: $MQTT_PORT"
echo "ESPHome port: $ESPHOME_PORT"

sudo apt update
sudo apt install -y mosquitto mosquitto-clients python3-venv python3-pip

sudo tee /etc/mosquitto/conf.d/noxuos-local.conf >/dev/null <<EOF
listener $MQTT_PORT 0.0.0.0
allow_anonymous true
EOF

sudo systemctl enable mosquitto
sudo systemctl restart mosquitto

sudo mkdir -p "$ESPHOME_DIR/config" "$ESPHOME_DIR/venv"
sudo chown -R "$(id -un):$(id -gn)" "$ESPHOME_DIR"

if [[ ! -x "$ESPHOME_DIR/venv/bin/esphome" ]]; then
  python3 -m venv "$ESPHOME_DIR/venv"
  "$ESPHOME_DIR/venv/bin/python" -m pip install --upgrade pip wheel
  "$ESPHOME_DIR/venv/bin/python" -m pip install --retries 10 --timeout 120 --resume-retries 10 esphome
fi

sudo tee /etc/systemd/system/esphome-dashboard.service >/dev/null <<EOF
[Unit]
Description=ESPHome Dashboard for NoxuOS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$ESPHOME_DIR/config
ExecStart=$ESPHOME_DIR/venv/bin/esphome dashboard $ESPHOME_DIR/config --address 0.0.0.0 --port $ESPHOME_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable esphome-dashboard.service
sudo systemctl restart esphome-dashboard.service

echo
echo "Service status:"
systemctl is-active mosquitto
systemctl is-active esphome-dashboard.service

echo
echo "Listening ports:"
ss -ltnp | grep -E ":($MQTT_PORT|$ESPHOME_PORT)" || true

echo
echo "MQTT loopback test:"
(timeout 5 mosquitto_sub -h 127.0.0.1 -p "$MQTT_PORT" -t noxuos/test -C 1 > /tmp/noxuos-mqtt-test.out &) >/dev/null 2>&1
sleep 1
mosquitto_pub -h 127.0.0.1 -p "$MQTT_PORT" -t noxuos/test -m ready
sleep 1
cat /tmp/noxuos-mqtt-test.out

echo
echo "ESPHome:"
"$ESPHOME_DIR/venv/bin/esphome" version

echo
echo "Pi 5 automation services ready."
