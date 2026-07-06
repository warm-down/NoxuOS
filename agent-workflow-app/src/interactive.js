require('dotenv').config();
const readline = require('readline');
const { createDefaultProvider } = require('./AIProvider');
const EmpireBridge = require('./EmpireBridge');
const { DirectorAgent } = require('./DirectorAgent');
const { LibrarianAgent } = require('./LibrarianAgent');
const VoiceInterface = require('./VoiceInterface');

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     AI EMPIRE - COMMAND CENTER        ║');
  console.log('║     Type "help" for commands          ║');
  console.log('╚════════════════════════════════════════╝\n');

  const provider = createDefaultProvider();
  const empire = new EmpireBridge({
    provider,
    role: process.env.DEVICE_ROLE || 'coordinator',
    deviceName: process.env.DEVICE_NAME || 'Windows-Main',
    piHost: process.env.PI_HOST || 'http://localhost:5000',
    wsUrl: process.env.EMPIRE_WS || 'ws://localhost:8765'
  });

  await empire.connect();

  const director = new DirectorAgent(provider, empire);
  const librarian = new LibrarianAgent(provider);
  const voice = new VoiceInterface(director);

  if (process.env.ENABLE_VOICE === 'true') {
    voice.start();
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  function printHelp() {
    console.log(`
Commands:
  <anything>      Talk to The Director
  file: <path>    Ask Librarian to analyze a file
  search: <term>  Search files under LIBRARIAN_ROOT/current app folder
  scan network    Run Watchdog defensive status check
  organize        Suggest organization for the current root
  status          Show local node, models, and loaded skills
  voice           Start CLI voice fallback
  exit            Shutdown
`);
  }

  async function handleInput(input) {
    const raw = String(input || '').trim();
    const cmd = raw.toLowerCase();

    if (!raw) return;

    if (cmd === 'help') {
      printHelp();
      return;
    }

    if (cmd === 'exit' || cmd === 'quit') {
      console.log('Shutting down...');
      rl.close();
      return;
    }

    if (cmd === 'status') {
      console.log(`\n${await director.handleCommand('status')}\n`);
      return;
    }

    if (cmd === 'voice') {
      voice.start();
      return;
    }

    if (cmd === 'organize') {
      console.log('\nLibrarian:', await librarian.organizeDirectory(), '\n');
      return;
    }

    if (cmd.startsWith('file:')) {
      const targetPath = raw.slice(5).trim();
      console.log('\nLibrarian:', await librarian.analyzeFile(targetPath), '\n');
      return;
    }

    if (cmd.startsWith('search:')) {
      const term = raw.slice(7).trim();
      console.log('\nLibrarian found:', await librarian.searchFiles(term), '\n');
      return;
    }

    console.log(`\nAgent:\n${await director.handleCommand(raw)}\n`);
  }

  rl.setPrompt('You: ');
  if (process.stdin.isTTY) rl.prompt();

  let chain = Promise.resolve();
  rl.on('line', (line) => {
    chain = chain
      .then(() => handleInput(line))
      .catch((error) => console.error(`\nAgent error: ${error.message}\n`))
      .finally(() => {
        if (!rl.closed && process.stdin.isTTY) rl.prompt();
      });
  });
}

main().catch((error) => {
  console.error('Command center failed:', error);
  process.exit(1);
});
