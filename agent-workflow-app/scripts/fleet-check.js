require('dotenv').config();

const DEFAULT_EXPECTED = 'main-laptop,Kali-XPS-Security';

function namesFromEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main() {
  const piHost = (process.env.PI_HOST || 'http://pi5.local:5000').replace(/\/$/, '');
  const expected = namesFromEnv(process.env.FLEET_EXPECTED || DEFAULT_EXPECTED);
  const requireModels = process.env.FLEET_REQUIRE_MODELS !== 'false';
  const requireBus = process.argv.includes('--require-bus') || process.env.FLEET_REQUIRE_BUS === 'true';

  const response = await fetch(`${piHost}/devices`, {
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`device registry returned ${response.status}`);
  }

  const devices = await response.json();
  const byName = new Map(devices.map((device) => [device.name, device]));
  let busClients = null;
  const failures = [];

  try {
    const busResponse = await fetch(`${piHost}/bus/clients`, {
      signal: AbortSignal.timeout(3000)
    });
    if (busResponse.ok) {
      const bus = await busResponse.json();
      busClients = new Set(bus.clients || []);
    }
  } catch {
    // Older Pi controllers do not expose active bus clients.
  }

  console.log(`Fleet registry: ${piHost}/devices`);
  for (const device of devices) {
    const models = device.models || [];
    const busStatus = busClients
      ? ` bus=${busClients.has(device.name) ? 'connected' : 'offline'}`
      : (typeof device.bus_connected === 'boolean' ? ` bus=${device.bus_connected ? 'connected' : 'offline'}` : '');
    console.log(
      `- ${device.name} (${device.role}) ${device.status} ip=${device.ip} models=${models.length}${busStatus}`
    );
  }

  if (requireBus && !busClients && !devices.some((device) => typeof device.bus_connected === 'boolean')) {
    failures.push('Pi controller does not expose active bus clients yet; pull/restart pi-controller first');
  }

  for (const name of expected) {
    const device = byName.get(name);
    if (!device) {
      failures.push(`${name} is missing`);
      continue;
    }

    if (device.status !== 'online') {
      failures.push(`${name} is not online (${device.status})`);
    }

    if (requireModels && (!device.models || device.models.length === 0)) {
      failures.push(`${name} has no registered models`);
    }

    const busConnected = busClients
      ? busClients.has(name)
      : device.bus_connected;
    if (requireBus && busConnected !== true) {
      failures.push(`${name} is not actively connected to the WebSocket bus`);
    }
  }

  if (failures.length > 0) {
    console.error('\nFleet not ready:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('\nFleet ready.');
}

main().catch((error) => {
  console.error(`[FLEET] Check failed: ${error.message}`);
  process.exit(1);
});
