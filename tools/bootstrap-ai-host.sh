#!/usr/bin/env bash
set -euo pipefail

MODELS="${MODELS:-llama3.2:latest qwen2.5:latest mistral:latest deepseek-r1:latest}"
EXPOSE_OLLAMA_LAN="${EXPOSE_OLLAMA_LAN:-false}"
INSTALL_OPEN_WEBUI="${INSTALL_OPEN_WEBUI:-true}"
OPEN_WEBUI_PORT="${OPEN_WEBUI_PORT:-3000}"
OPEN_WEBUI_CONTAINER="${OPEN_WEBUI_CONTAINER:-open-webui}"
TRUSTED_SUBNET="${TRUSTED_SUBNET:-}"
INSTALL_TAILSCALE="${INSTALL_TAILSCALE:-false}"

require_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "Run this on the Linux AI host."
    exit 1
  fi
}

install_base_packages() {
  sudo apt update
  sudo apt install -y curl ca-certificates gnupg
}

install_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    echo "Ollama already installed: $(ollama --version 2>/dev/null || true)"
    return
  fi

  echo "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
}

configure_ollama_binding() {
  if [[ "$EXPOSE_OLLAMA_LAN" != "true" ]]; then
    echo "Keeping Ollama bound to localhost. Set EXPOSE_OLLAMA_LAN=true only on trusted LAN/Tailscale."
    return
  fi

  echo "Exposing Ollama on 0.0.0.0:11434 for trusted network clients."
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF
  sudo systemctl daemon-reload
}

start_ollama() {
  sudo systemctl enable ollama >/dev/null 2>&1 || true
  sudo systemctl restart ollama >/dev/null 2>&1 || sudo systemctl start ollama >/dev/null 2>&1 || true

  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      echo "Ollama API ready."
      return
    fi
    sleep 1
  done

  echo "Ollama did not become ready on 127.0.0.1:11434."
  exit 1
}

pull_models() {
  echo "Pulling models: $MODELS"
  for model in $MODELS; do
    ollama pull "$model"
  done
}

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1; then
    echo "Docker ready: $(docker --version)"
    return
  fi

  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
  echo "Docker installed. You may need to log out/in for non-sudo docker access."
}

run_open_webui() {
  if [[ "$INSTALL_OPEN_WEBUI" != "true" ]]; then
    echo "Skipping Open WebUI. Set INSTALL_OPEN_WEBUI=true to install it."
    return
  fi

  install_docker_if_needed

  local docker_cmd=(docker)
  if ! docker ps >/dev/null 2>&1; then
    docker_cmd=(sudo docker)
  fi

  "${docker_cmd[@]}" rm -f "$OPEN_WEBUI_CONTAINER" >/dev/null 2>&1 || true
  "${docker_cmd[@]}" run -d \
    -p "${OPEN_WEBUI_PORT}:8080" \
    -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
    --add-host=host.docker.internal:host-gateway \
    -v open-webui:/app/backend/data \
    --name "$OPEN_WEBUI_CONTAINER" \
    --restart always \
    ghcr.io/open-webui/open-webui:main
}

install_tailscale() {
  if [[ "$INSTALL_TAILSCALE" != "true" ]]; then
    return
  fi

  if ! command -v tailscale >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh
  fi

  echo "Starting Tailscale SSH. Complete browser auth if prompted."
  sudo tailscale up --ssh
}

configure_firewall_hint() {
  if [[ -z "$TRUSTED_SUBNET" ]]; then
    echo "Firewall note: restrict ports 11434 and ${OPEN_WEBUI_PORT} to LAN/Tailscale. Set TRUSTED_SUBNET=192.168.1.0/24 for UFW rules."
    return
  fi

  if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow from "$TRUSTED_SUBNET" to any port 11434 proto tcp || true
    sudo ufw allow from "$TRUSTED_SUBNET" to any port "$OPEN_WEBUI_PORT" proto tcp || true
    echo "UFW rules added for $TRUSTED_SUBNET."
  else
    echo "UFW not installed. Restrict 11434/${OPEN_WEBUI_PORT} to $TRUSTED_SUBNET with your firewall."
  fi
}

main() {
  require_linux

  echo "== NoxuOS AI Host Bootstrap =="
  echo "Models: $MODELS"
  echo "Expose Ollama LAN: $EXPOSE_OLLAMA_LAN"
  echo "Install Open WebUI: $INSTALL_OPEN_WEBUI"

  install_base_packages
  install_ollama
  configure_ollama_binding
  start_ollama
  pull_models
  run_open_webui
  install_tailscale
  configure_firewall_hint

  local ip
  ip="$(hostname -I | awk '{print $1}')"

  echo
  echo "AI host ready."
  echo "Ollama:     http://${ip}:11434"
  echo "Open WebUI: http://${ip}:${OPEN_WEBUI_PORT}"
  echo
  echo "On Windows .env, use:"
  echo "AI_BOX_HOST=${ip}"
  echo "AI_BOX_OLLAMA_BASE_URL=http://${ip}:11434"
  echo "OPEN_WEBUI_URL=http://${ip}:${OPEN_WEBUI_PORT}"
}

main "$@"
