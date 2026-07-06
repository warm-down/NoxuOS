require('dotenv').config();
const net = require('net');

const DEFAULT_EXPECTED_CLIENTS = 'main-laptop,Kali-XPS-Security';

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function namesFromEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function portFromUrl(url, fallback) {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return fallback;
  }
}

async function httpJson(url, timeoutMs = 5000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

function tcpCheck(host, port, timeoutMs = 3500) {
  return new Promise((resolve) => {
    if (!host || !port) {
      resolve({ ok: false, detail: 'not configured' });
      return;
    }

    const socket = new net.Socket();
    let done = false;

    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, detail });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, `${host}:${port} open`));
    socket.once('timeout', () => finish(false, `${host}:${port} timed out`));
    socket.once('error', (error) => finish(false, `${host}:${port} ${error.code || error.message}`));
    socket.connect(port, host);
  });
}

function print(name, ok, detail, critical = false) {
  const label = ok ? 'PASS' : (critical ? 'FAIL' : 'WARN');
  console.log(`[${label}] ${name}${detail ? ` - ${detail}` : ''}`);
  return { name, ok, detail, critical };
}

async function checkPi(results) {
  const piHost = stripSlash(env('PI_HOST', 'http://pi5.local:5000'));
  const expectedClients = namesFromEnv(env('FLEET_EXPECTED', DEFAULT_EXPECTED_CLIENTS));

  try {
    const health = await httpJson(`${piHost}/health`);
    results.push(print('Pi controller health', health.ok, `${piHost}/health HTTP ${health.status}`, true));
  } catch (error) {
    results.push(print('Pi controller health', false, error.message, true));
  }

  try {
    const devices = await httpJson(`${piHost}/devices`);
    const list = Array.isArray(devices.data) ? devices.data : [];
    results.push(print('Pi device registry', devices.ok, `${list.length} registered device(s)`, true));
  } catch (error) {
    results.push(print('Pi device registry', false, error.message, true));
  }

  try {
    const bus = await httpJson(`${piHost}/bus/clients`);
    const clients = bus.data?.clients || [];
    const missing = expectedClients.filter((name) => !clients.includes(name));
    const detail = bus.ok
      ? [
        clients.length ? clients.join(', ') : 'none',
        missing.length ? `missing expected: ${missing.join(', ')}` : 'expected clients connected'
      ].join('; ')
      : `${piHost}/bus/clients HTTP ${bus.status}`;
    results.push(print('Pi active bus clients', bus.ok && missing.length === 0, detail, true));
  } catch (error) {
    results.push(print('Pi active bus clients', false, 'pi-controller needs pull/restart for /bus/clients', true));
  }
}

async function checkAiHost(results) {
  const ollamaUrl = stripSlash(env('AI_BOX_OLLAMA_BASE_URL', env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')));

  try {
    const tags = await httpJson(`${ollamaUrl}/api/tags`);
    const models = tags.data?.models?.map((model) => model.name) || [];
    results.push(print('AI host Ollama', tags.ok && models.length > 0, `${models.length} model(s) at ${ollamaUrl}`, true));
  } catch (error) {
    results.push(print('AI host Ollama', false, error.message, true));
  }

  const webui = stripSlash(env('OPEN_WEBUI_URL'));
  if (!webui) {
    results.push(print('Open WebUI', false, 'OPEN_WEBUI_URL not configured', false));
  } else {
    const tcp = await tcpCheck(hostFromUrl(webui), portFromUrl(webui, 3000));
    results.push(print('Open WebUI', tcp.ok, tcp.detail, false));
  }
}

async function checkHomeAutomation(results) {
  const haUrl = stripSlash(env('HOME_ASSISTANT_URL', 'http://homeassistant.local:8123'));
  const mqttHost = env('MQTT_HOST', env('HOME_ASSISTANT_HOST', hostFromUrl(haUrl)));
  const mqttPort = Number(env('MQTT_PORT', 1883));
  const esphomeHost = env('ESPHOME_HOST', env('HOME_ASSISTANT_HOST', hostFromUrl(haUrl)));
  const esphomePort = Number(env('ESPHOME_DASHBOARD_PORT', 6052));

  try {
    const ha = await fetch(haUrl, { signal: AbortSignal.timeout(5000) });
    results.push(print('Home Assistant', true, `${haUrl} HTTP ${ha.status}`, false));
  } catch (error) {
    results.push(print('Home Assistant', false, error.message, false));
  }

  const mqtt = await tcpCheck(mqttHost, mqttPort);
  results.push(print('MQTT broker', mqtt.ok, mqtt.detail, false));

  const esphome = await tcpCheck(esphomeHost, esphomePort);
  results.push(print('ESPHome dashboard', esphome.ok, esphome.detail, false));
}

async function checkAccess(results) {
  const hosts = [
    ['Raspberry Pi SSH', env('RASPBERRY_PI_HOST', hostFromUrl(env('PI_HOST', 'http://pi5.local:5000')))],
    ['AI box SSH', env('AI_BOX_HOST')],
    ['Other worker SSH', env('OTHER_SYSTEM_HOST')]
  ];

  for (const [name, host] of hosts) {
    if (!host) {
      results.push(print(name, false, 'not configured', false));
      continue;
    }

    const ssh = await tcpCheck(host, 22);
    results.push(print(name, ssh.ok, ssh.detail, false));
  }
}

async function checkStorage(results) {
  const syncthingUrl = stripSlash(env('SYNCTHING_URL'));
  if (!syncthingUrl) {
    results.push(print('Storage/Syncthing', false, 'SYNCTHING_URL not configured', false));
    return;
  }

  const tcp = await tcpCheck(hostFromUrl(syncthingUrl), portFromUrl(syncthingUrl, 8384));
  results.push(print('Storage/Syncthing', tcp.ok, tcp.detail, false));
}

async function main() {
  console.log('NoxuOS Three-System Architecture Check');
  console.log('=====================================');
  console.log('Windows = control, Pi = automation hub, Linux = AI host/worker');
  console.log('');

  const results = [];
  await checkPi(results);
  await checkAiHost(results);
  await checkHomeAutomation(results);
  await checkAccess(results);
  await checkStorage(results);

  const failures = results.filter((result) => result.critical && !result.ok);
  console.log('');
  if (failures.length) {
    console.log(`Architecture not ready: ${failures.length} critical layer(s) failed.`);
    process.exit(1);
  }

  console.log('Core architecture ready.');
}

main().catch((error) => {
  console.error(`[ARCH] Check failed: ${error.message}`);
  process.exit(1);
});
