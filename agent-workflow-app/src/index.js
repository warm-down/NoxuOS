require('dotenv').config();
const { WorkflowEngine } = require('./WorkflowEngine');
const { createDefaultProvider } = require('./AIProvider');
const EmpireBridge = require('./EmpireBridge');

async function main() {
  const provider = createDefaultProvider();
  const empire = new EmpireBridge({ provider });
  empire.connect().catch((error) => {
    console.warn('[EMPIRE] Bridge startup failed:', error.message);
  });

  const engine = new WorkflowEngine({ provider });
  const task = 'Draft a product announcement for the new AI-powered operating system feature.';
  const result = await engine.runWorkflow(task);

  console.log('--- Multi-Agent Workflow Result ---\n');
  console.log('Task:', result.task, '\n');
  console.log('Draft:\n', result.draft, '\n');
  console.log('Review summary:\n', result.review.summary, '\n');
  console.log('Recommendations:\n', result.review.improvements.join('\n'), '\n');
  console.log('Final draft:\n', result.finalDraft, '\n');
  console.log('Timeline:');
  result.timeline.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.agent.name} (${step.agent.role}) ${step.action}`);
  });
}

main().catch((error) => {
  console.error('Workflow failed:', error);
  process.exit(1);
});
