require('dotenv').config();
const { createDefaultProvider } = require('./AIProvider');
const EmpireBridge = require('./EmpireBridge');

async function main() {
  const provider = createDefaultProvider();
  const bridge = new EmpireBridge({
    provider,
    role: process.env.DEVICE_ROLE || 'worker',
    deviceName: process.env.DEVICE_NAME || 'worker-node'
  });

  const status = await bridge.connect();

  if (status.mode === 'standalone') {
    console.log('[WORKER] Mesh unavailable. Worker is idle in standalone mode.');
  } else {
    console.log(`[WORKER] ${status.registration.name} ready as ${status.registration.role}.`);
    console.log('[WORKER] Waiting for mesh commands. Press Ctrl+C to stop.');
  }

  const shutdown = () => {
    console.log('\n[WORKER] Shutting down...');
    bridge.close();
    setTimeout(() => process.exit(0), 100);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  setInterval(async () => {
    try {
      await bridge.registerWithController(await bridge.buildRegistration());
    } catch (error) {
      // Keep the worker alive during transient hub/network outages.
    }
  }, Number(process.env.WORKER_HEARTBEAT_MS || 60000));
}

main().catch((error) => {
  console.error(`[WORKER] Failed: ${error.message}`);
  process.exit(1);
});
