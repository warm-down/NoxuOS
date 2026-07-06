require('dotenv').config();
const { createDefaultProvider } = require('./AIProvider');
const EmpireBridge = require('./EmpireBridge');
const { DirectorAgent } = require('./DirectorAgent');
const { TelegramBridge } = require('./TelegramBridge');

async function main() {
  const provider = createDefaultProvider();
  const empire = new EmpireBridge({
    provider,
    role: process.env.DEVICE_ROLE || 'coordinator',
    deviceName: process.env.DEVICE_NAME || 'main-laptop'
  });

  await empire.connect();

  const director = new DirectorAgent(provider, empire);
  const telegram = new TelegramBridge({ director });

  const shutdown = () => {
    console.log('\n[TELEGRAM] Shutting down...');
    telegram.stop();
    empire.close();
    setTimeout(() => process.exit(0), 100);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await telegram.start();
}

main().catch((error) => {
  console.error(`[TELEGRAM] Failed: ${error.message}`);
  process.exit(1);
});
