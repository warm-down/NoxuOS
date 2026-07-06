#!/usr/bin/env bash
set -euo pipefail

NODE_KIND="${1:-auto}"
PI_ADDRESS="${PI_ADDRESS:-192.168.1.243}"
APP_DIR="${APP_DIR:-$HOME/NoxuOS/agent-workflow-app}"

detect_node_kind() {
  local name
  name="$(hostname | tr '[:upper:]' '[:lower:]')"

  if [[ "$NODE_KIND" != "auto" ]]; then
    echo "$NODE_KIND"
  elif [[ "$name" == *"kali"* ]]; then
    echo "kali"
  elif [[ -e /proc/device-tree/model ]] && tr -d '\0' </proc/device-tree/model | grep -qi "raspberry pi"; then
    echo "pi"
  else
    echo "worker"
  fi
}

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

wait_for_ollama() {
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Ollama did not respond on 127.0.0.1:11434."
  return 1
}

install_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    echo "Ollama already installed: $(ollama --version 2>/dev/null || true)"
    return
  fi

  echo "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
}

start_ollama() {
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable ollama >/dev/null 2>&1 || true
    sudo systemctl restart ollama >/dev/null 2>&1 || sudo systemctl start ollama >/dev/null 2>&1 || true
  fi

  if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "Starting Ollama in the background..."
    nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
  fi

  wait_for_ollama
}

pull_models() {
  local kind="$1"
  local default_models

  case "$kind" in
    pi)
      default_models="llama3.2:latest"
      ;;
    kali)
      default_models="llama3.2:latest qwen2.5:7b"
      ;;
    *)
      default_models="llama3.2:latest"
      ;;
  esac

  local models="${MODELS:-$default_models}"

  echo "Pulling models: $models"
  for model in $models; do
    ollama pull "$model"
  done
}

configure_agent_app() {
  local kind="$1"

  if [[ ! -d "$APP_DIR" ]]; then
    echo "Agent app not found at $APP_DIR; skipping .env update."
    return
  fi

  cd "$APP_DIR"

  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      cp .env.example .env
    else
      touch .env
    fi
  fi

  set_env .env AI_PROVIDER ollama
  set_env .env OLLAMA_BASE_URL http://127.0.0.1:11434
  set_env .env OLLAMA_MODEL "${OLLAMA_MODEL:-llama3.2:latest}"
  set_env .env OLLAMA_CONTEXT_WINDOW "${OLLAMA_CONTEXT_WINDOW:-2048}"

  case "$kind" in
    pi)
      set_env .env DEVICE_NAME "${DEVICE_NAME:-pi5-model-node}"
      set_env .env DEVICE_ROLE "${DEVICE_ROLE:-worker}"
      set_env .env PI_HOST http://127.0.0.1:5000
      set_env .env EMPIRE_WS ws://127.0.0.1:8765
      ;;
    kali)
      set_env .env DEVICE_NAME "${DEVICE_NAME:-Kali-XPS-Security}"
      set_env .env DEVICE_ROLE "${DEVICE_ROLE:-security}"
      set_env .env PI_HOST "http://${PI_ADDRESS}:5000"
      set_env .env EMPIRE_WS "ws://${PI_ADDRESS}:8765"
      ;;
    *)
      set_env .env DEVICE_NAME "${DEVICE_NAME:-$(hostname)}"
      set_env .env DEVICE_ROLE "${DEVICE_ROLE:-worker}"
      set_env .env PI_HOST "http://${PI_ADDRESS}:5000"
      set_env .env EMPIRE_WS "ws://${PI_ADDRESS}:8765"
      ;;
  esac

  if command -v npm >/dev/null 2>&1 && [[ -f package.json ]]; then
    npm install
  else
    echo "npm not available or package.json missing; skipping npm install."
  fi
}

main() {
  local kind
  kind="$(detect_node_kind)"

  echo "== NoxuOS Ollama Node Bootstrap =="
  echo "Node kind: $kind"
  echo "Pi address: $PI_ADDRESS"

  sudo apt update
  sudo apt install -y curl ca-certificates

  install_ollama
  start_ollama
  pull_models "$kind"
  configure_agent_app "$kind"

  echo
  echo "Ollama models:"
  ollama list

  echo
  echo "Ollama API:"
  curl -fsS http://127.0.0.1:11434/api/tags >/dev/null
  echo "ready"

  echo
  echo "Next check:"
  echo "  cd $APP_DIR"
  echo "  npm run bridge:check"
}

main "$@"
