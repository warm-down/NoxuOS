const assert = require('assert');
const { WorkflowEngine } = require('../src/WorkflowEngine');
const { MockProvider } = require('../src/AIProvider');

async function runTests() {
  const engine = new WorkflowEngine({ provider: new MockProvider() });
  const task = 'Write a launch summary for a new AI notebook feature.';
  const result = await engine.runWorkflow(task);

  assert.strictEqual(result.task, task, 'Task should be preserved');
  assert.ok(result.draft.includes(task), 'Draft should mention the task');
  assert.ok(result.review.improvements.length > 0, 'Reviewer should provide improvement recommendations');
  assert.ok(result.finalDraft.includes('Revised according to reviewer feedback'), 'Final draft should incorporate review feedback');

  console.log('All tests passed.');
}

runTests().catch((error) => {
  console.error('Test failure:', error);
  process.exit(1);
});
