const { WriterAgent, ReviewerAgent } = require('./Agent');
const { createDefaultProvider } = require('./AIProvider');

class WorkflowEngine {
  constructor({ provider, writerAgent, reviewerAgent } = {}) {
    const effectiveProvider = provider || createDefaultProvider();
    this.writer = writerAgent || new WriterAgent(effectiveProvider);
    this.reviewer = reviewerAgent || new ReviewerAgent(effectiveProvider);
  }

  async runWorkflow(task) {
    const draft = await this.writer.createDraft(task);
    const review = await this.reviewer.reviewDraft(draft);
    const finalDraft = await this.writer.refineDraft(draft, review);

    return {
      task,
      draft,
      review,
      finalDraft,
      timeline: [
        { agent: this.writer.metadata, action: 'created draft', content: draft },
        { agent: this.reviewer.metadata, action: 'reviewed draft', content: review },
        { agent: this.writer.metadata, action: 'refined draft', content: finalDraft }
      ]
    };
  }
}

module.exports = {
  WorkflowEngine
};
