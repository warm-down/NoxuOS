require('dotenv').config();
const { createDefaultProvider } = require('./AIProvider');
const EmpireBridge = require('./EmpireBridge');
const { DirectorAgent } = require('./DirectorAgent');
const VoiceInterface = require('./VoiceInterface');

async function main() {
  const provider = createDefaultProvider();
  const empire = new EmpireBridge({
    provider,
    role: process.env.DEVICE_ROLE || 'coordinator',
    deviceName: process.env.DEVICE_NAME || 'main-laptop'
  });

  await empire.connect();

  const director = new DirectorAgent(provider, empire);
  const voice = new VoiceInterface(director);

  const shutdown = () => {
    console.log('\n[VOICE] Shutting down...');
    empire.close();
    setTimeout(() => process.exit(0), 100);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  voice.start();
}

main().catch((error) => {
  console.error(`[VOICE] Failed: ${error.message}`);
  process.exit(1);
});
