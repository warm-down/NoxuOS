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

  const response = await fetch(`${piHost}/devices`, {
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`device registry returned ${response.status}`);
  }

  const devices = await response.json();
  const byName = new Map(devices.map((device) => [device.name, device]));
  const failures = [];

  console.log(`Fleet registry: ${piHost}/devices`);
  for (const device of devices) {
    const models = device.models || [];
    console.log(
      `- ${device.name} (${device.role}) ${device.status} ip=${device.ip} models=${models.length}`
    );
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
