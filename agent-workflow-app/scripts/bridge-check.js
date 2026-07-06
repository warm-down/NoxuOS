require('dotenv').config();
const EmpireBridge = require('../src/EmpireBridge');

async function main() {
  const bridge = new EmpireBridge();
  const status = await bridge.connect();

  console.log(JSON.stringify(status.registration, null, 2));

  if (status.mode === 'standalone') {
    console.log('[EMPIRE] Standalone mode is ready. Pi 5 controller can be added later.');
    return;
  }

  await bridge.reportStatus();
  console.log('[EMPIRE] Mesh mode is ready.');
  bridge.close();
}

main().catch((error) => {
  console.error('[EMPIRE] Bridge check failed:', error);
  process.exit(1);
});
