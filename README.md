# **NoxuOS**  
*Redefining Operating Systems with AI-Driven Intelligence*

---

## **Introduction**  
Welcome to **NoxuOS**, the world’s first AI-first operating system, built from the ground up to harness the full potential of artificial intelligence. NoxuOS reimagines the user experience by eliminating traditional apps, enabling seamless task management, and dynamically adapting to user needs—all powered by a cutting-edge AI kernel and on-device intelligence.  

NoxuOS is more than an OS; it’s a living assistant, a gaming powerhouse, and a secure, scalable platform for the future of personal computing.

---

## **Key Features**
- **AI-Driven Core**: NoxuOS is powered by an innovative AI kernel, offering real-time decision-making and task optimization.
- **App-Free Ecosystem**: Users interact with AI directly to complete tasks, removing the need for traditional apps.  
- **Hybrid AI Architecture**: Combines on-device intelligence for privacy and speed with optional cloud support for heavy processing.  
- **Gaming Ready**: Seamless integration of popular games, ensuring high-performance experiences with no interruptions.  
- **Open Source AI Models**: Developers can extend and adapt AI functionality to meet their needs.  

---

### **Supported Devices**
NoxuOS is designed to work seamlessly across a range of devices:

- **Mobile Devices**: NoxuOS will run on smartphones and tablets, providing an intuitive AI-driven experience on portable devices. The OS adapts to the capabilities of the hardware, offering powerful multitasking and resource management for mobile platforms.
  
- **Laptops and Desktops**: On more powerful devices, like laptops and desktop computers, NoxuOS will unlock more advanced features, such as enhanced performance for multitasking, complex AI models, and integration with productivity tools.

- **Wearables & Smart Home Devices**: NoxuOS will be capable of connecting with wearable devices (smartwatches, fitness trackers) and smart home devices (smart thermostats, lights, security systems), providing a unified experience across all connected devices. This ensures that users can manage and interact with their ecosystem seamlessly.

The OS adapts its capabilities based on the hardware, ensuring optimal performance regardless of the device used.

---

## **Project Goals**
1. **From-Scratch Kernel**: A custom kernel designed to fully support AI-driven architecture, optimized for performance, scalability, and parallelism.  
2. **User-Centric Design**: Prioritizing simplicity and intuitive interaction, removing complexity for end users.  
3. **Developer-Friendly**: Open-source and modular, enabling contributions from a global developer community.  
4. **Future-Proof**: Built to adapt and grow with advancements in hardware, AI models, and user expectations.

---

## **System Requirements**
- **Processor**: ARM-based (Snapdragon 8 Gen 1 or newer) or x86-64 architecture.
- **Memory**: 8GB RAM minimum, 16GB recommended.  
- **Storage**: 64GB minimum, SSD recommended for optimal performance.  
- **GPU**: Adreno 700 Series or equivalent for gaming and intensive tasks.  

---

## **Getting Started**
### **For Users**  
1. Download the latest release from the [Releases](#) page.  
2. Flash the OS onto your device using the included installer.  
3. Reboot your device and follow the onboarding process.  

### **For Developers**  
1. Clone the repository:  
   ```bash
   git clone https://github.com/NoxuOS/Noxu.git
   ```
2. Install build dependencies (see Build Guide).
3. Compile the kernel and deploy to supported hardware or virtual machine.
4. Contribute by creating new AI models or optimizing system components.

### **Agent Workflow Prototype**
NoxuOS includes a runnable multi-agent prototype in `agent-workflow-app`. It wires together a Writer agent and Reviewer agent with a mock provider by default, and can use OpenAI when `OPENAI_API_KEY` is configured.

```powershell
cd agent-workflow-app
npm install
npm test
npm start
```

### **Loading Ollama Models On Pi Or Kali**
Use `tools/bootstrap-ollama-node.sh` on Linux nodes to install Ollama, start it locally, pull models, and configure `agent-workflow-app/.env`.

Pi 5 lightweight model host:

```bash
cd ~/NoxuOS
git pull
./tools/bootstrap-ollama-node.sh pi
```

Kali security node:

```bash
cd ~/NoxuOS
git pull
PI_ADDRESS=192.168.1.243 ./tools/bootstrap-ollama-node.sh kali
```

Override model choices when needed:

```bash
MODELS="llama3.2:latest" ./tools/bootstrap-ollama-node.sh pi
MODELS="llama3.2:latest qwen2.5:7b" PI_ADDRESS=192.168.1.243 ./tools/bootstrap-ollama-node.sh kali
```

The script keeps Ollama local to each node at `127.0.0.1:11434`. It does not expose Windows Ollama to the LAN.

After bootstrapping the Linux nodes, verify the fleet from Windows:

```powershell
cd agent-workflow-app
npm run fleet:check
```

For connectivity-only checks while models are still downloading:

```powershell
$env:FLEET_REQUIRE_MODELS="false"; npm run fleet:check; Remove-Item Env:FLEET_REQUIRE_MODELS
```

### **Telegram Main Agent Bridge**
Create a Telegram bot with `@BotFather`, put the token in `agent-workflow-app/.env`, then discover your private chat ID.

```powershell
cd agent-workflow-app
npm run telegram:token
npm run telegram:setup
```

`npm run telegram:token` reads the BotFather token from your clipboard or prompts for it, then stores it in `.env` without printing it. After sending your bot a message, run setup again and add the displayed chat ID:

```env
TELEGRAM_BOT_TOKEN=123456:your-token
TELEGRAM_ALLOWED_CHAT_ID=123456789
TELEGRAM_ALLOW_ALL=false
```

Start the supervised bridge:

```powershell
npm run telegram
```

Unknown chats are rejected by default and hardware actions remain approval-gated.

Voice options:

- Fastest: use your phone keyboard's microphone/dictation button so Telegram sends normal text to the bot.
- Full voice notes: install Whisper and ffmpeg on the main agent, then set `TELEGRAM_VOICE_ENABLED=true`.

Windows Whisper setup:

```powershell
python -m pip install -U openai-whisper
winget install Gyan.FFmpeg
```

Voice-note `.env` settings:

```env
TELEGRAM_VOICE_ENABLED=true
TELEGRAM_WHISPER_COMMAND=whisper
TELEGRAM_WHISPER_MODEL=base
TELEGRAM_WHISPER_LANGUAGE=en
TELEGRAM_REPLY_AUDIO=false
```

Set `TELEGRAM_REPLY_AUDIO=true` if you want the bridge to send a generated audio reply as well as text. On Windows it uses built-in `System.Speech`; on Linux it expects `espeak`.

### **Authorized Camera Checks From Telegram**
Camera checks are routed to the configured security node, usually Kali. They only scan approved private `/24` subnets and only check common camera service ports.

Configure the main agent and Kali with:

```env
SECURITY_NODE_NAME=Kali-XPS-Security
CAMERA_SCAN_SUBNET=192.168.1.0/24
CAMERA_SCAN_ALLOWED_SUBNETS=192.168.1.0/24
CAMERA_SCAN_PORTS=80,443,554,8080,8888
```

Update Kali so it can receive the mesh command:

```bash
cd ~/NoxuOS
git pull
cd agent-workflow-app
npm install
npm run bridge:check
npm run worker
```

Then message Telegram:

```text
check cameras
check cameras on 192.168.1.0/24
home security camera sweep
```

The scanner reports web and RTSP candidates only. It does not attempt logins, password guessing, authentication bypass, or public camera discovery.

Runtime layout:

```text
Windows: npm run telegram
Kali:    npm run worker
Pi 5:    empire-pi.service
```

Install Kali as an always-on systemd worker:

```bash
cd ~/NoxuOS
git pull
PI_ADDRESS=192.168.1.243 DEVICE_NAME=Kali-XPS-Security DEVICE_ROLE=security ./tools/install-agent-worker-service.sh
```

Check logs:

```bash
sudo journalctl -u noxuos-agent-worker.service -f
```

## **How It Works**
AI Kernel: Manages system resources, user interactions, and parallel task execution efficiently.
Task Manager: Instead of apps, tasks are directly assigned to the OS, e.g., “Prepare a presentation” or “Check emails.”
Gaming Engine: Supports direct integration of AAA mobile and PC games for native play.

## **Roadmap**
### **v0.1 (Pre-Alpha):**
Initial AI kernel development.
Basic task management and interaction.
### **v0.2 (Alpha):**
Support for hybrid on-device/cloud AI processing.
Experimental gaming support.
### **v1.0 (Beta):**
Fully functional AI-driven OS with multi-tasking, gaming, and customization.

## **Contributing**
NoxuOS thrives on collaboration. If you’d like to contribute:

Review the Contribution Guidelines.
Submit feature requests or bug reports in Issues.
Join our community on [Discord](https://discord.gg/kwE5MqYydh).
## **License**
NoxuOS is released under the Apache 2.0 License. See LICENSE for details.
