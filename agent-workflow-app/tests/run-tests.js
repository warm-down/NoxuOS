const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkflowEngine } = require('../src/WorkflowEngine');
const { MockProvider } = require('../src/AIProvider');
const { DirectorAgent } = require('../src/DirectorAgent');
const { LibrarianAgent } = require('../src/LibrarianAgent');
const { WatchdogAgent, summarizeListeningPorts } = require('../src/WatchdogAgent');
const { TelegramBridge, parseAllowedChatIds, splitMessage } = require('../src/TelegramBridge');
const { assertAllowedSubnet, normalizeSubnet, parsePorts } = require('../src/CameraScanner');
const { extractSubnet } = require('../src/DirectorAgent');
const { parseWakeCommand } = require('../src/WakeWords');
const { createLogger, redact } = require('../src/StructuredLogger');

async function runTests() {
  const provider = new MockProvider();
  const engine = new WorkflowEngine({ provider });
  const task = 'Write a launch summary for a new AI notebook feature.';
  const result = await engine.runWorkflow(task);

  assert.strictEqual(result.task, task, 'Task should be preserved');
  assert.ok(result.draft.includes(task), 'Draft should mention the task');
  assert.ok(result.review.improvements.length > 0, 'Reviewer should provide improvement recommendations');
  assert.ok(result.finalDraft.includes('Revised according to reviewer feedback'), 'Final draft should incorporate review feedback');

  const director = new DirectorAgent(provider, {
    buildRegistration: async () => ({
      name: 'test-node',
      role: 'test',
      models: ['mock-model'],
      skills: ['writer', 'reviewer']
    })
  });
  const directorResponse = await director.handleCommand('write a short launch note');
  assert.ok(directorResponse.includes('write a short launch note'), 'Director should route writing requests');

  const status = await director.handleCommand('status');
  assert.ok(status.includes('test-node'), 'Director should report local status');

  const librarian = new LibrarianAgent(provider, { rootDir: process.cwd() });
  const files = await librarian.searchFiles('package*.json', process.cwd(), 5);
  assert.ok(files.some((file) => file.path.endsWith('package.json')), 'Librarian should support wildcard file search');

  const watchdog = new WatchdogAgent(provider, { enableNetworkScan: false });
  const watchdogReport = await watchdog.analyzeSecurity();
  assert.ok(watchdogReport.assessment, 'Watchdog should produce an assessment');
  assert.strictEqual(watchdogReport.network.skipped, true, 'Network scan should be opt-in for tests');
  const portSummary = summarizeListeningPorts([
    'TCP    0.0.0.0:445      0.0.0.0:0      LISTENING',
    'TCP    [::]:3389        [::]:0         LISTENING'
  ]);
  assert.strictEqual(portSummary.length, 2, 'Watchdog should summarize unique listeners');
  assert.strictEqual(portSummary[0].service, 'SMB file sharing', 'Watchdog should label common Windows services');

  const allowed = parseAllowedChatIds('123, 456');
  assert.ok(allowed.has('123'), 'Telegram allowlist should parse first chat ID');
  assert.ok(allowed.has('456'), 'Telegram allowlist should parse second chat ID');

  const chunks = splitMessage('a'.repeat(9000), 1000);
  assert.ok(chunks.length > 1, 'Telegram bridge should split long messages');
  assert.ok(chunks.every((chunk) => chunk.length <= 1000), 'Telegram chunks should respect the limit');

  const telegram = new TelegramBridge({
    token: 'test-token',
    director,
    allowedChatIds: parseAllowedChatIds('42'),
    apiBaseUrl: 'https://example.invalid'
  });
  assert.strictEqual(telegram.isChatAllowed(42), true, 'Telegram should allow configured chat IDs');
  assert.strictEqual(telegram.isChatAllowed(43), false, 'Telegram should reject unknown chat IDs');
  assert.ok(telegram.helpText(42).includes('Voice'), 'Telegram help should mention voice command options');

  const voiceMessages = [];
  const voiceTelegram = new TelegramBridge({
    token: 'test-token',
    director,
    allowedChatIds: parseAllowedChatIds('42'),
    apiBaseUrl: 'https://example.invalid'
  });
  voiceTelegram.sendMessage = async (_chatId, text) => voiceMessages.push(text);
  await voiceTelegram.handleUpdate({
    message: {
      chat: { id: 42 },
      voice: { file_id: 'voice-file', duration: 1 }
    }
  });
  assert.ok(
    voiceMessages.some((message) => message.includes('local transcription is disabled')),
    'Telegram voice notes should fail safely when transcription is disabled'
  );

  assert.strictEqual(normalizeSubnet('192.168.1'), '192.168.1.0/24', 'Camera scanner should normalize three-octet subnets');
  assert.strictEqual(assertAllowedSubnet('192.168.1', ['192.168.1.0/24']), '192.168.1.0/24', 'Camera scanner should allow configured private subnets');
  assert.throws(() => assertAllowedSubnet('8.8.8.0/24', ['8.8.8.0/24']), /private subnets/, 'Camera scanner should reject public subnets');
  assert.throws(() => assertAllowedSubnet('192.168.2.0/24', ['192.168.1.0/24']), /not in CAMERA_SCAN_ALLOWED_SUBNETS/, 'Camera scanner should reject unapproved private subnets');
  assert.deepStrictEqual(parsePorts('80, 554, bad, 70000'), [80, 554], 'Camera scanner should parse valid ports only');
  assert.strictEqual(extractSubnet('check cameras on 192.168.1.0/24'), '192.168.1.0/24', 'Director should extract /24 camera subnet');

  const directorWake = parseWakeCommand('yo empire status', { requireWakeWord: true });
  assert.strictEqual(directorWake.agent, 'director', 'Director wake word should select Director');
  assert.strictEqual(directorWake.command, 'status', 'Director wake word should strip wake phrase');

  const kaliWake = parseWakeCommand('kali check cameras', { requireWakeWord: true });
  assert.strictEqual(kaliWake.agent, 'watchdog', 'Kali wake word should select Watchdog');
  assert.strictEqual(kaliWake.command, 'check cameras', 'Agent wake word should preserve the command');

  const quietWake = parseWakeCommand('random room chatter', { requireWakeWord: true });
  assert.strictEqual(quietWake.accepted, false, 'Required wake mode should ignore chatter');

  const redacted = redact({ TELEGRAM_BOT_TOKEN: 'secret', nested: { apiKey: 'also-secret', value: 1 } });
  assert.strictEqual(redacted.TELEGRAM_BOT_TOKEN, '[redacted]', 'Structured logger should redact token fields');
  assert.strictEqual(redacted.nested.apiKey, '[redacted]', 'Structured logger should redact nested API key fields');
  assert.strictEqual(redacted.nested.value, 1, 'Structured logger should preserve safe fields');

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noxuos-logs-'));
  const logPath = path.join(logDir, 'agents.jsonl');
  const rotatingLogger = createLogger('test', {
    logPath,
    errorLogPath: path.join(logDir, 'errors.jsonl'),
    maxBytes: 1,
    backups: 2
  });
  rotatingLogger.info('first', { value: 1 });
  rotatingLogger.info('second', { value: 2 });
  assert.ok(fs.existsSync(`${logPath}.1`), 'Structured logger should rotate oversized logs');
  assert.ok(fs.readFileSync(logPath, 'utf8').includes('"event":"second"'), 'Structured logger should keep writing after rotation');

  console.log('All tests passed.');
}

runTests().catch((error) => {
  console.error('Test failure:', error);
  process.exit(1);
});
