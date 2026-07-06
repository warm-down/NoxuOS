require('dotenv').config();
const { createDefaultProvider } = require('./AIProvider');
const EmpireBridge = require('./EmpireBridge');
const { createLogger } = require('./StructuredLogger');

const logger = createLogger('worker-entrypoint');

async function main() {
  const provider = createDefaultProvider();
  const bridge = new EmpireBridge({
    provider,
    role: process.env.DEVICE_ROLE || 'worker',
    deviceName: process.env.DEVICE_NAME || 'worker-node'
  });

  const status = await bridge.connect();

  if (status.mode === 'standalone') {
    logger.warn('worker.standalone', { registration: status.registration });
    console.log('[WORKER] Mesh unavailable. Worker is idle in standalone mode.');
  } else {
    logger.action('worker.ready', { registration: status.registration });
    console.log(`[WORKER] ${status.registration.name} ready as ${status.registration.role}.`);
    console.log('[WORKER] Waiting for mesh commands. Press Ctrl+C to stop.');
  }

  const shutdown = () => {
    logger.action('worker.shutdown');
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
      logger.warn('worker.heartbeat.failed', { error: error.message });
      // Keep the worker alive during transient hub/network outages.
    }
  }, Number(process.env.WORKER_HEARTBEAT_MS || 60000));
}

main().catch((error) => {
  logger.error('worker.failed', error);
  console.error(`[WORKER] Failed: ${error.message}`);
  process.exit(1);
});
