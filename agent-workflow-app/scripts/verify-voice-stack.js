require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseWakeCommand } = require('../src/WakeWords');
const { createLogger, DEFAULT_LOG_PATH } = require('../src/StructuredLogger');

const execFileAsync = promisify(execFile);
const logger = createLogger('service-verifier');
const results = [];

function record(name, pass, detail = '', critical = true) {
  const result = { name, pass: Boolean(pass), detail, critical };
  results.push(result);
  const mark = pass ? 'PASS' : (critical ? 'FAIL' : 'WARN');
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
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

async function fetchJson(url, timeoutMs = 5000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }
  return { response, data };
}

async function getProcesses() {
  const script = [
    "Get-CimInstance Win32_Process |",
    "Where-Object { $_.CommandLine -match 'src[\\\\/]telegram\\.js|src[\\\\/]local-voice\\.js|ollama serve' } |",
    "Select-Object ProcessId,CommandLine | ConvertTo-Json -Depth 4"
  ].join(' ');

  const result = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  if (!result.ok || !result.stdout) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function hasProcess(processes, pattern) {
  return processes.some((item) => new RegExp(pattern, 'i').test(item.CommandLine || ''));
}

async function verifyOllama() {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  try {
    const { response, data } = await fetchJson(`${baseUrl}/api/tags`);
    const models = data?.models?.map((model) => model.name) || [];
    record('Ollama API', response.ok && models.length > 0, `${models.length} model(s) at ${baseUrl}`);
  } catch (error) {
    record('Ollama API', false, error.message);
  }
}

async function verifyFleet() {
  const piHost = (process.env.PI_HOST || 'http://pi5.local:5000').replace(/\/$/, '');
  try {
    const { response, data } = await fetchJson(`${piHost}/devices`);
    const devices = Array.isArray(data) ? data : [];
    record('Pi mesh registry', response.ok, `${devices.length} registered device(s) at ${piHost}`);
  } catch (error) {
    record('Pi mesh registry', false, error.message);
  }
}

async function verifyTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    record('Telegram token', false, 'TELEGRAM_BOT_TOKEN missing');
    return;
  }

  const apiBaseUrl = (process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org').replace(/\/$/, '');
  try {
    const { response, data } = await fetchJson(`${apiBaseUrl}/bot${token}/getMe`);
    record('Telegram Bot API', response.ok && data?.ok, data?.result?.username ? `@${data.result.username}` : 'connected');
  } catch (error) {
    record('Telegram Bot API', false, error.message);
  }

  record(
    'Telegram chat allowlist',
    Boolean(process.env.TELEGRAM_ALLOWED_CHAT_ID),
    process.env.TELEGRAM_ALLOWED_CHAT_ID ? 'configured' : 'TELEGRAM_ALLOWED_CHAT_ID missing'
  );
  record(
    'Telegram voice notes',
    process.env.TELEGRAM_VOICE_ENABLED === 'true',
    process.env.TELEGRAM_VOICE_ENABLED === 'true' ? 'enabled' : 'TELEGRAM_VOICE_ENABLED is not true'
  );
}

async function verifyAudio() {
  const mic = await run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Add-Type -AssemblyName System.Speech; $r=New-Object System.Speech.Recognition.SpeechRecognitionEngine; $r.SetInputToDefaultAudioDevice(); "default microphone ready"'
  ]);
  record('Laptop microphone', mic.ok, mic.ok ? mic.stdout : mic.error);

  const speaker = await run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; ($s.GetInstalledVoices() | Select-Object -First 1).VoiceInfo.Name'
  ]);
  record('Local text-to-speech', speaker.ok, speaker.ok ? speaker.stdout : speaker.error);
}

async function verifyWhisper() {
  if (process.env.TELEGRAM_VOICE_ENABLED !== 'true') {
    record('Local Whisper', false, 'voice notes disabled', false);
    return;
  }

  const whisper = await run('py', ['-3.11', '-c', 'import whisper; print("whisper ready")']);
  const ffmpeg = await run('ffmpeg', ['-version'], { timeout: 5000 });

  record('Local Whisper', whisper.ok, whisper.ok ? whisper.stdout : whisper.error);
  record('ffmpeg', ffmpeg.ok, ffmpeg.ok ? ffmpeg.stdout.split(/\r?\n/)[0] : ffmpeg.error);
}

function verifyWakeWords() {
  const director = parseWakeCommand('wake up status', { requireWakeWord: true });
  const kali = parseWakeCommand('kali check cameras', { requireWakeWord: true });

  record('Director wake phrase', director.accepted && director.agent === 'director' && director.command === 'status', JSON.stringify(director));
  record('Per-agent wake phrase', kali.accepted && kali.agent === 'watchdog', JSON.stringify(kali));
}

async function verifyProcesses() {
  const processes = await getProcesses();
  record('Ollama process', hasProcess(processes, 'ollama serve'), 'ollama serve process', false);
  record('Telegram bridge process', hasProcess(processes, 'src[\\\\/]telegram\\.js|npm run telegram'), `${processes.length} matched voice-stack process(es)`);
  record('Laptop voice listener process', hasProcess(processes, 'src[\\\\/]local-voice\\.js|npm run voice:listen'), `${processes.length} matched voice-stack process(es)`);
}

async function verifyAutostart() {
  if (process.platform !== 'win32') {
    record('Auto-start after reboot', false, 'Windows startup check skipped on this OS', false);
    return;
  }

  const task = await run('schtasks', ['/Query', '/TN', 'NoxuOS Voice Stack'], { timeout: 5000 });
  const startupCmd = path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'NoxuOS Voice Stack.cmd'
  );
  const fallbackExists = startupCmd && fs.existsSync(startupCmd);
  record(
    'Auto-start after reboot',
    task.ok || fallbackExists,
    task.ok ? 'scheduled task installed' : (fallbackExists ? `startup launcher installed for ${os.userInfo().username}` : 'not installed')
  );
}

function verifyLogs() {
  logger.action('service.verify.log_write', { check: true });
  const ok = fs.existsSync(DEFAULT_LOG_PATH);
  record('Structured action log', ok, DEFAULT_LOG_PATH);
}

async function main() {
  console.log('NoxuOS Voice Stack Verification');
  console.log('================================');

  await verifyOllama();
  await verifyFleet();
  await verifyTelegram();
  await verifyWhisper();
  await verifyAudio();
  verifyWakeWords();
  await verifyProcesses();
  await verifyAutostart();
  verifyLogs();

  const failedCritical = results.filter((result) => result.critical && !result.pass);
  logger.action('service.verify.complete', {
    passed: results.filter((result) => result.pass).length,
    failedCritical: failedCritical.length,
    results
  });

  if (failedCritical.length) {
    console.log('');
    console.log(`Voice stack NOT ready: ${failedCritical.length} critical check(s) failed.`);
    process.exit(1);
  }

  console.log('');
  console.log('Voice stack ready.');
}

main().catch((error) => {
  logger.error('service.verify.error', error);
  console.error(`[VERIFY] Failed: ${error.message}`);
  process.exit(1);
});
