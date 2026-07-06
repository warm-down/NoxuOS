require('dotenv').config();
const readline = require('readline');
const { createDefaultProvider } = require('./AIProvider');
const EmpireBridge = require('./EmpireBridge');
const { DirectorAgent } = require('./DirectorAgent');

async function main() {
  const provider = createDefaultProvider();
  const empire = new EmpireBridge({
    provider,
    role: process.env.DEVICE_ROLE || 'coordinator'
  });

  await empire.connect();

  const director = new DirectorAgent(provider, empire);

  console.log('\nAI EMPIRE - COMMAND CENTER');
  console.log('Agents: Writer, Reviewer, Librarian queued, Watchdog queued, Maestro queued');
  console.log('Commands: help, status, exit\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.setPrompt('You: ');
  if (process.stdin.isTTY) {
    rl.prompt();
  }

  let chain = Promise.resolve();
  let shuttingDown = false;

  async function processLine(line) {
    if (shuttingDown) return;

    const input = line.trim();
    const lower = input.toLowerCase();

    if (lower === 'exit' || lower === 'quit') {
      shuttingDown = true;
      console.log('Shutting down command center.');
      rl.close();
      return;
    }

    if (lower === 'help') {
      console.log('\nTry:');
      console.log('- write a launch summary for NoxuOS');
      console.log('- review this draft: <paste text>');
      console.log('- status\n');
      if (process.stdin.isTTY) {
        rl.prompt();
      }
      return;
    }

    try {
      const response = await director.handleCommand(input);
      console.log(`\nAgent:\n${response}\n`);
    } catch (error) {
      console.error(`\nAgent error: ${error.message}\n`);
    }

    if (process.stdin.isTTY) {
      rl.prompt();
    }
  }

  rl.on('line', (line) => {
    chain = chain.then(() => processLine(line)).catch((error) => {
      console.error(`\nAgent error: ${error.message}\n`);
    });
  });
}

main().catch((error) => {
  console.error('Command center failed:', error);
  process.exit(1);
});
