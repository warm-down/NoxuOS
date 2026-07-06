#!/usr/bin/env bash
set -u

HA_URL="${HOME_ASSISTANT_URL:-${HA_URL:-http://homeassistant.local:8123}}"
HA_TOKEN="${HOME_ASSISTANT_TOKEN:-${HA_TOKEN:-}}"
MQTT_HOST="${MQTT_HOST:-}"
MQTT_PORT="${MQTT_PORT:-1883}"
ESPHOME_HOST="${ESPHOME_HOST:-}"
ESPHOME_DASHBOARD_PORT="${ESPHOME_DASHBOARD_PORT:-6052}"
ESPHOME_DEVICE_HOSTS="${ESPHOME_DEVICE_HOSTS:-}"
CAMERA_HOSTS="${CAMERA_HOSTS:-}"
CAMERA_PORTS="${CAMERA_PORTS:-80,443,554,8080,8888}"

FAILURES=0

url_host() {
  python3 - "$1" <<'PY'
from urllib.parse import urlparse
import sys

parsed = urlparse(sys.argv[1])
print(parsed.hostname or sys.argv[1])
PY
}

HA_HOST="$(url_host "$HA_URL")"
MQTT_HOST="${MQTT_HOST:-$HA_HOST}"
ESPHOME_HOST="${ESPHOME_HOST:-$HA_HOST}"

pass() {
  printf '[PASS] %s - %s\n' "$1" "$2"
}

warn() {
  printf '[WARN] %s - %s\n' "$1" "$2"
}

fail() {
  printf '[FAIL] %s - %s\n' "$1" "$2"
  FAILURES=$((FAILURES + 1))
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Dependency" "missing command: $1"
    return 1
  fi
  return 0
}

tcp_check() {
  python3 - "$1" "$2" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

try:
    with socket.create_connection((host, port), timeout=4):
        print("open")
except Exception as exc:
    print(str(exc))
    sys.exit(1)
PY
}

check_tcp() {
  local name="$1"
  local host="$2"
  local port="$3"
  local critical="${4:-false}"

  local output
  if output="$(tcp_check "$host" "$port" 2>&1)"; then
    pass "$name" "$host:$port open"
  elif [[ "$critical" == "true" ]]; then
    fail "$name" "$host:$port $output"
  else
    warn "$name" "$host:$port $output"
  fi
}

check_http() {
  local name="$1"
  local url="$2"
  local critical="${3:-false}"
  local status

  status="$(curl -k -sS -m 8 -o /tmp/haos-check-body.$$ -w '%{http_code}' "$url" 2>/tmp/haos-check-error.$$ || true)"
  if [[ "$status" =~ ^2|3|401$ ]]; then
    pass "$name" "$url HTTP $status"
  elif [[ "$critical" == "true" ]]; then
    fail "$name" "$url HTTP ${status:-none} $(cat /tmp/haos-check-error.$$ 2>/dev/null)"
  else
    warn "$name" "$url HTTP ${status:-none} $(cat /tmp/haos-check-error.$$ 2>/dev/null)"
  fi

  rm -f /tmp/haos-check-body.$$ /tmp/haos-check-error.$$
}

check_api() {
  local api_url="${HA_URL%/}/api/"
  local status

  if [[ -n "$HA_TOKEN" ]]; then
    status="$(curl -k -sS -m 8 -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" -o /tmp/haos-api-body.$$ -w '%{http_code}' "$api_url" 2>/tmp/haos-api-error.$$ || true)"
    if [[ "$status" =~ ^2 ]]; then
      pass "Home Assistant API token" "$api_url HTTP $status"
    else
      fail "Home Assistant API token" "$api_url HTTP ${status:-none} $(cat /tmp/haos-api-error.$$ 2>/dev/null)"
    fi
  else
    status="$(curl -k -sS -m 8 -o /tmp/haos-api-body.$$ -w '%{http_code}' "$api_url" 2>/tmp/haos-api-error.$$ || true)"
    if [[ "$status" == "401" || "$status" =~ ^2 ]]; then
      warn "Home Assistant API token" "API reachable; set HOME_ASSISTANT_TOKEN for authenticated checks"
    else
      warn "Home Assistant API" "$api_url HTTP ${status:-none} $(cat /tmp/haos-api-error.$$ 2>/dev/null)"
    fi
  fi

  rm -f /tmp/haos-api-body.$$ /tmp/haos-api-error.$$
}

check_csv_hosts() {
  local label="$1"
  local hosts="$2"
  local ports="$3"

  if [[ -z "$hosts" ]]; then
    warn "$label" "no hosts configured"
    return
  fi

  IFS=',' read -ra host_list <<<"$hosts"
  IFS=',' read -ra port_list <<<"$ports"

  for host in "${host_list[@]}"; do
    host="$(echo "$host" | xargs)"
    [[ -z "$host" ]] && continue
    for port in "${port_list[@]}"; do
      port="$(echo "$port" | xargs)"
      [[ -z "$port" ]] && continue
      check_tcp "$label $host" "$host" "$port" false
    done
  done
}

echo "NoxuOS Home Assistant OS LAN Check"
echo "=================================="
echo "Home Assistant URL: $HA_URL"
echo "Home Assistant host: $HA_HOST"
echo

need_cmd python3 >/dev/null || true
need_cmd curl >/dev/null || true

if getent hosts "$HA_HOST" >/tmp/haos-hosts.$$ 2>/dev/null; then
  pass "Name resolution" "$(cat /tmp/haos-hosts.$$ | head -n 1)"
else
  warn "Name resolution" "$HA_HOST did not resolve; use HOME_ASSISTANT_URL=http://<ip>:8123"
fi
rm -f /tmp/haos-hosts.$$

check_tcp "Home Assistant TCP" "$HA_HOST" 8123 true
check_http "Home Assistant frontend" "$HA_URL" true
check_api

check_tcp "MQTT broker" "$MQTT_HOST" "$MQTT_PORT" false
check_tcp "ESPHome dashboard" "$ESPHOME_HOST" "$ESPHOME_DASHBOARD_PORT" false
check_csv_hosts "ESPHome device API" "$ESPHOME_DEVICE_HOSTS" "6053"
check_csv_hosts "Camera candidate" "$CAMERA_HOSTS" "$CAMERA_PORTS"

echo
if [[ "$FAILURES" -gt 0 ]]; then
  echo "HAOS LAN check failed: $FAILURES critical check(s)."
  exit 1
fi

echo "HAOS LAN base path is reachable."
