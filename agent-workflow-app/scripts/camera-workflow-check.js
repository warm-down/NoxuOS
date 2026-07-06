require('dotenv').config();
const { createDefaultProvider } = require('../src/AIProvider');
const EmpireBridge = require('../src/EmpireBridge');
const { DirectorAgent } = require('../src/DirectorAgent');
const { createLogger } = require('../src/StructuredLogger');

const logger = createLogger('camera-workflow-check');

async function main() {
  const subnet = process.env.CAMERA_SCAN_SUBNET || '192.168.1.0/24';
  const provider = createDefaultProvider();
  const empire = new EmpireBridge({
    provider,
    role: process.env.DEVICE_ROLE || 'coordinator',
    deviceName: process.env.DEVICE_NAME || 'main-laptop'
  });

  const connection = await empire.connect();
  logger.action('cameraWorkflow.check.start', { subnet, connection });

  try {
    const director = new DirectorAgent(provider, empire);
    const response = await director.handleCommand(`kali check cameras on ${subnet}`);
    console.log(response);

    if (/failed|unavailable|timed out|not connected/i.test(response)) {
      logger.error('cameraWorkflow.check.failed', new Error(response), { subnet });
      process.exitCode = 1;
      return;
    }

    logger.action('cameraWorkflow.check.complete', { subnet, outputChars: response.length });
  } finally {
    empire.close();
  }
}

main().catch((error) => {
  logger.error('cameraWorkflow.check.error', error);
  console.error(`[CAMERA] Workflow check failed: ${error.message}`);
  process.exit(1);
});
