const assert = require('assert');
const { WorkflowEngine } = require('../src/WorkflowEngine');
const { MockProvider } = require('../src/AIProvider');
const { DirectorAgent } = require('../src/DirectorAgent');
const { LibrarianAgent } = require('../src/LibrarianAgent');

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

  console.log('All tests passed.');
}

runTests().catch((error) => {
  console.error('Test failure:', error);
  process.exit(1);
});
