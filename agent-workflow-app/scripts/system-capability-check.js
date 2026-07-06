require('dotenv').config();
const { execFile } = require('child_process');
const { promisify } = require('util');
const net = require('net');

const execFileAsync = promisify(execFile);

function ok(value, detail = '') {
  return { ok: Boolean(value), detail };
}

function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}

async function run(command, args = [], options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      windowsHide: true,
      timeout: options.timeout || 10000,
      maxBuffer: options.maxBuffer || 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...(options.env || {}) }
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { ok: false, stdout: error.stdout?.trim() || '', stderr: error.stderr?.trim() || '', error: error.message };
  }
}

async function powershellJson(script) {
  const result = await run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `${script} | ConvertTo-Json -Depth 6`
  ], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 });

  if (!result.ok || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function tcpCheck(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (open, detail) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok: open, detail });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, `${host}:${port} open`));
    socket.once('timeout', () => finish(false, `${host}:${port} timed out`));
    socket.once('error', (error) => finish(false, `${host}:${port} ${error.code || error.message}`));
    socket.connect(port, host);
  });
}

function urlHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function urlPort(url, fallback) {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return fallback;
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDisk(disks) {
  const list = Array.isArray(disks) ? disks : (disks ? [disks] : []);
  return list
    .map((disk) => `${disk.Name || disk.Root}: ${formatBytes(disk.Free)} free / ${formatBytes((disk.Free || 0) + (disk.Used || 0))} total`)
    .join('; ') || 'unknown';
}

function formatGpu(gpus) {
  const list = Array.isArray(gpus) ? gpus : (gpus ? [gpus] : []);
  return list
    .map((gpu) => `${gpu.Name || 'unknown'}${gpu.AdapterRAM ? ` (${formatBytes(gpu.AdapterRAM)} VRAM)` : ''}`)
    .join('; ') || 'unknown';
}

async function httpCheck(url, timeoutMs = 5000) {
  try {
    const response = await fetch(url, { signal: timeoutSignal(timeoutMs) });
    return { ok: true, detail: `${url} HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: `${url} ${error.message}` };
  }
}

async function getHardware() {
  const cpu = await powershellJson('Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed');
  const ram = await powershellJson('Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory');
  const gpu = await powershellJson('Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor');
  const disk = await powershellJson('Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free,Root');
  const osInfo = await powershellJson('Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime');

  return { cpu, ram, gpu, disk, os: osInfo };
}

async function getPython() {
  const pyList = await run('py', ['-0p']);
  const py311 = await run('py', ['-3.11', '--version']);
  const whisper = await run('py', ['-3.11', '-c', 'import whisper; print(whisper.__file__)']);
  const ffmpeg = await run('ffmpeg', ['-version'], { timeout: 5000 });

  return {
    launcher: pyList.ok ? pyList.stdout : pyList.error,
    python311: py311.ok ? py311.stdout || py311.stderr : py311.error,
    whisper: ok(whisper.ok, whisper.ok ? whisper.stdout : whisper.error),
    ffmpeg: ok(ffmpeg.ok, ffmpeg.ok ? ffmpeg.stdout.split(/\r?\n/)[0] : ffmpeg.error)
  };
}

async function getOllama() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: timeoutSignal(5000) });
    const data = await response.json();
    const models = data.models?.map((model) => model.name) || [];
    return { ok: response.ok, baseUrl, modelCount: models.length, models };
  } catch (error) {
    return { ok: false, baseUrl, detail: error.message, modelCount: 0, models: [] };
  }
}

async function getHomeAutomation() {
  const homeAssistantUrl = process.env.HOME_ASSISTANT_URL || 'http://homeassistant.local:8123';
  const mqttHost = process.env.MQTT_HOST || process.env.HOME_ASSISTANT_HOST || urlHost(homeAssistantUrl);
  const mqttPort = Number(process.env.MQTT_PORT || 1883);
  const esphomeHost = process.env.ESPHOME_HOST || process.env.HOME_ASSISTANT_HOST || urlHost(homeAssistantUrl);
  const esphomeDashboardPort = Number(process.env.ESPHOME_DASHBOARD_PORT || 6052);
  const esphomeApiPort = Number(process.env.ESPHOME_API_PORT || 6053);

  return {
    homeAssistant: await httpCheck(homeAssistantUrl),
    homeAssistantTcp: await tcpCheck(urlHost(homeAssistantUrl), urlPort(homeAssistantUrl, 8123)),
    mqtt: await tcpCheck(mqttHost, mqttPort),
    esphomeDashboard: await tcpCheck(esphomeHost, esphomeDashboardPort),
    esphomeApi: await tcpCheck(esphomeHost, esphomeApiPort)
  };
}

async function getAudioVideo() {
  const mic = await run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Add-Type -AssemblyName System.Speech; $r=New-Object System.Speech.Recognition.SpeechRecognitionEngine; $r.SetInputToDefaultAudioDevice(); "default microphone ready"'
  ]);

  const speakerScript = process.env.CAPABILITY_SPEAKER_TEST === 'true'
    ? 'Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak("NoxuOS speaker check"); "speaker test spoken"'
    : 'Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; ($s.GetInstalledVoices() | Select-Object -First 1).VoiceInfo.Name';

  const speaker = await run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    speakerScript
  ], { timeout: 15000 });

  const cameras = await powershellJson("Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -in @('Camera','Image') -or $_.Name -match 'camera|webcam' } | Select-Object Name,Status,PNPClass");

  return {
    microphone: ok(mic.ok, mic.ok ? mic.stdout : mic.error),
    speaker: ok(speaker.ok, speaker.ok ? speaker.stdout : speaker.error),
    cameras: Array.isArray(cameras) ? cameras : (cameras ? [cameras] : [])
  };
}

async function getProcesses() {
  const processes = await powershellJson("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'src[\\\\/]telegram\\.js|src[\\\\/]local-voice\\.js|src[\\\\/]worker\\.js|ollama serve' } | Select-Object ProcessId,CommandLine");
  return Array.isArray(processes) ? processes : (processes ? [processes] : []);
}

async function getFleet() {
  const piHost = (process.env.PI_HOST || 'http://pi5.local:5000').replace(/\/$/, '');
  try {
    const response = await fetch(`${piHost}/devices`, { signal: timeoutSignal(5000) });
    const devices = await response.json();
    return { ok: response.ok, piHost, devices };
  } catch (error) {
    return { ok: false, piHost, detail: error.message, devices: [] };
  }
}

async function getTelegram() {
  return {
    tokenSet: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    allowedChatSet: Boolean(process.env.TELEGRAM_ALLOWED_CHAT_ID),
    voiceEnabled: process.env.TELEGRAM_VOICE_ENABLED === 'true',
    replyAudio: process.env.TELEGRAM_REPLY_AUDIO === 'true'
  };
}

function summarize(report) {
  const lines = [
    'NoxuOS Capability Check',
    '======================',
    `OS: ${report.hardware.os?.Caption || 'unknown'} ${report.hardware.os?.Version || ''}`,
    `CPU: ${report.hardware.cpu?.Name || 'unknown'} (${report.hardware.cpu?.NumberOfCores || '?'} cores / ${report.hardware.cpu?.NumberOfLogicalProcessors || '?'} threads)`,
    `RAM: ${formatBytes(report.hardware.ram?.TotalPhysicalMemory)}`,
    `GPU/VRAM: ${formatGpu(report.hardware.gpu)}`,
    `Disk: ${formatDisk(report.hardware.disk)}`,
    `Python: ${report.python.python311}`,
    `Whisper: ${report.python.whisper.ok ? 'ready' : 'not ready'} - ${report.python.whisper.detail}`,
    `ffmpeg: ${report.python.ffmpeg.ok ? 'ready' : 'not ready'} - ${report.python.ffmpeg.detail}`,
    `Ollama: ${report.ollama.ok ? 'ready' : 'not ready'} (${report.ollama.modelCount} models)`,
    `Home Assistant: ${report.homeAutomation.homeAssistant.ok ? 'reachable' : 'not reachable'} - ${report.homeAutomation.homeAssistant.detail}`,
    `MQTT: ${report.homeAutomation.mqtt.ok ? 'ready' : 'not ready'} - ${report.homeAutomation.mqtt.detail}`,
    `ESPHome dashboard: ${report.homeAutomation.esphomeDashboard.ok ? 'ready' : 'not ready'} - ${report.homeAutomation.esphomeDashboard.detail}`,
    `Microphone: ${report.audioVideo.microphone.ok ? 'ready' : 'not ready'} - ${report.audioVideo.microphone.detail}`,
    `Speaker: ${report.audioVideo.speaker.ok ? 'ready' : 'not ready'} - ${report.audioVideo.speaker.detail}`,
    `Cameras detected: ${report.audioVideo.cameras.length}`,
    `Telegram: token=${report.telegram.tokenSet ? 'set' : 'missing'} chat=${report.telegram.allowedChatSet ? 'set' : 'missing'} voice=${report.telegram.voiceEnabled ? 'on' : 'off'}`,
    `Fleet: ${report.fleet.ok ? 'reachable' : 'not reachable'} (${report.fleet.devices.length} registered devices)`,
    `Voice stack processes: ${report.processes.length}`
  ];

  return lines.join('\n');
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    hardware: await getHardware(),
    python: await getPython(),
    ollama: await getOllama(),
    homeAutomation: await getHomeAutomation(),
    audioVideo: await getAudioVideo(),
    telegram: await getTelegram(),
    fleet: await getFleet(),
    processes: await getProcesses()
  };

  console.log(summarize(report));

  if (process.env.CAPABILITY_JSON === 'true') {
    console.log('\nJSON');
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(`[CAPABILITY] Check failed: ${error.message}`);
  process.exit(1);
});
