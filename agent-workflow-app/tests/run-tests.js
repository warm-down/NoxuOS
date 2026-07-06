const assert = require('assert');
const { WorkflowEngine } = require('../src/WorkflowEngine');
const { MockProvider } = require('../src/AIProvider');
const { DirectorAgent } = require('../src/DirectorAgent');
const { LibrarianAgent } = require('../src/LibrarianAgent');
const { WatchdogAgent } = require('../src/WatchdogAgent');
const { TelegramBridge, parseAllowedChatIds, splitMessage } = require('../src/TelegramBridge');
const { assertAllowedSubnet, normalizeSubnet, parsePorts } = require('../src/CameraScanner');
const { extractSubnet } = require('../src/DirectorAgent');

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

  assert.strictEqual(normalizeSubnet('192.168.1'), '192.168.1.0/24', 'Camera scanner should normalize three-octet subnets');
  assert.strictEqual(assertAllowedSubnet('192.168.1', ['192.168.1.0/24']), '192.168.1.0/24', 'Camera scanner should allow configured private subnets');
  assert.throws(() => assertAllowedSubnet('8.8.8.0/24', ['8.8.8.0/24']), /private subnets/, 'Camera scanner should reject public subnets');
  assert.throws(() => assertAllowedSubnet('192.168.2.0/24', ['192.168.1.0/24']), /not in CAMERA_SCAN_ALLOWED_SUBNETS/, 'Camera scanner should reject unapproved private subnets');
  assert.deepStrictEqual(parsePorts('80, 554, bad, 70000'), [80, 554], 'Camera scanner should parse valid ports only');
  assert.strictEqual(extractSubnet('check cameras on 192.168.1.0/24'), '192.168.1.0/24', 'Director should extract /24 camera subnet');

  console.log('All tests passed.');
}

runTests().catch((error) => {
  console.error('Test failure:', error);
  process.exit(1);
});
