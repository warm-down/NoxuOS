#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

HA_URL="${HOME_ASSISTANT_URL:-${HA_URL:-}}"
PI400_IP="${PI400_IP:-}"
WAIT_SECONDS="${WAIT_SECONDS:-900}"
CHECK_INTERVAL="${CHECK_INTERVAL:-15}"

candidate_urls() {
  if [[ -n "$HA_URL" ]]; then
    echo "$HA_URL"
  fi

  if [[ -n "$PI400_IP" ]]; then
    echo "http://${PI400_IP}:8123"
  fi

  echo "http://homeassistant.local:8123"
  echo "http://homeassistant:8123"

  if command -v ip >/dev/null 2>&1; then
    local subnet
    subnet="$(ip -4 route show scope link 2>/dev/null | awk '/src/ {print $1; exit}')"
    if [[ "$subnet" =~ ^([0-9]+\.[0-9]+\.[0-9]+)\.0/24$ ]]; then
      local prefix="${BASH_REMATCH[1]}"
      for host in 2 3 4 5 10 20 50 100 150 200 243; do
        echo "http://${prefix}.${host}:8123"
      done
    fi
  fi
}

url_host() {
  python3 - "$1" <<'PY'
from urllib.parse import urlparse
import sys

parsed = urlparse(sys.argv[1])
print(parsed.hostname or sys.argv[1])
PY
}

url_port() {
  python3 - "$1" <<'PY'
from urllib.parse import urlparse
import sys

parsed = urlparse(sys.argv[1])
if parsed.port:
    print(parsed.port)
elif parsed.scheme == "https":
    print(443)
else:
    print(80)
PY
}

tcp_open() {
  python3 - "$1" "$2" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
try:
    with socket.create_connection((host, port), timeout=3):
        sys.exit(0)
except Exception:
    sys.exit(1)
PY
}

http_ready() {
  local url="$1"
  local status
  status="$(curl -k -sS -m 5 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
  [[ "$status" =~ ^2|3|401$ ]]
}

find_ready_url_once() {
  local seen=""
  while IFS= read -r url; do
    [[ -z "$url" ]] && continue
    case " $seen " in
      *" $url "*) continue ;;
    esac
    seen="$seen $url"

    local host
    local port
    host="$(url_host "$url")"
    port="$(url_port "$url")"

    if tcp_open "$host" "$port" && http_ready "$url"; then
      echo "$url"
      return 0
    fi
  done < <(candidate_urls)

  return 1
}

echo "NoxuOS Pi 400 Home Assistant OS Ready Check"
echo "==========================================="
echo "This runs from Kali/control laptop. It does not run on HAOS itself."
echo "Timeout: ${WAIT_SECONDS}s"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "[FAIL] python3 is required."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[FAIL] curl is required."
  exit 1
fi

deadline=$((SECONDS + WAIT_SECONDS))
ready_url=""

while [[ "$SECONDS" -le "$deadline" ]]; do
  if ready_url="$(find_ready_url_once)"; then
    break
  fi

  echo "[WAIT] Home Assistant not reachable yet. Waiting ${CHECK_INTERVAL}s..."
  sleep "$CHECK_INTERVAL"
done

if [[ -z "$ready_url" ]]; then
  echo
  echo "[FAIL] Home Assistant OS did not become reachable."
  echo "Try one of these after finding the Pi 400 IP in the router:"
  echo "  PI400_IP=192.168.1.X ./tools/pi400-haos-ready-check.sh"
  echo "  HOME_ASSISTANT_URL=http://192.168.1.X:8123 ./tools/pi400-haos-ready-check.sh"
  exit 1
fi

echo "[PASS] Home Assistant reachable at $ready_url"
echo

cd "$REPO_DIR"
HOME_ASSISTANT_URL="$ready_url" ./tools/haos-lan-check.sh
