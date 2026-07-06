# Local Agent Launch

This computer is the first NoxuOS local agent node. It runs the agent workflow through Ollama, so it can operate without an OpenAI API key.

## Current Node

- Runtime: Node.js app in `agent-workflow-app`
- Local model server: Ollama at `http://127.0.0.1:11434`
- Default launch model: `llama3.2:latest`
- Default generation cap: `OLLAMA_MAX_TOKENS=256`
- Bigger local models available on this machine include `dolphin-mixtral:latest`, `wizard-vicuna:latest`, `nous-hermes2:latest`, `qwen2.5:7b`, and `dolphin3:latest`.

## Verify This Computer

```powershell
cd agent-workflow-app
npm run launch:check
```

The launch check confirms:

- Ollama exists on PATH.
- Ollama API is reachable.
- The configured model is installed.
- The deterministic test suite passes.
- A live Writer -> Reviewer -> Writer workflow runs through Ollama.

## Bridge Check

The bridge advertises this computer to the future Pi 5 controller. If the Pi 5 is not online yet, it falls back to standalone mode and still prints the node registration payload.

```powershell
npm run bridge:check
```

Environment fields:

```env
DEVICE_NAME=main-laptop
DEVICE_ROLE=coordinator
PI_HOST=http://pi5.local:5000
EMPIRE_WS=ws://pi5.local:8765
```

## Change Model

Edit `.env`:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:latest
OLLAMA_MAX_TOKENS=256
```

Use `llama3.2:latest` for fast checks. Use larger models only when you want stronger output and can tolerate slower runs.

Run the full demo separately:

```powershell
npm start
```

## XPS 13 Next

On the XPS 13:

1. Install Git, Node.js, and Ollama.
2. Clone or pull the NoxuOS repo.
3. Install app dependencies:
   ```powershell
   cd agent-workflow-app
   npm install
   ```
4. Pull a small model first:
   ```powershell
   ollama pull llama3.2
   ```
5. Copy `.env.example` to `.env`.
6. Run:
   ```powershell
   npm run launch:check
   ```

After the XPS passes, it can become a second worker node. Keep this laptop as the coordinator until the network routing layer is added.

## Pi 5 Controller

The first Pi 5 controller lives in `../pi-controller`.

```bash
cd pi-controller
python3 -m pip install -r requirements.txt
python3 pi-controller.py
```
