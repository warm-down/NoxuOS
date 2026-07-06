const { createLogger } = require('./StructuredLogger');

class Agent {
  constructor(name, role, provider) {
    this.name = name;
    this.role = role;
    this.provider = provider;
    this.logger = createLogger(role);
  }

  get metadata() {
    return { name: this.name, role: this.role };
  }
}

function normalizeList(value, fallback) {
  const values = Array.isArray(value) ? value : [value || fallback];
  return values.map((item) => {
    if (typeof item === 'string') {
      return item;
    }
    if (item && typeof item === 'object') {
      return JSON.stringify(item);
    }
    return String(item);
  });
}

class WriterAgent extends Agent {
  constructor(provider, name = 'Writer', voice = 'clear and professional') {
    super(name, 'writer', provider);
    this.voice = voice;
  }

  async createDraft(task) {
    if (!this.provider) {
      throw new Error('WriterAgent requires a provider to generate content.');
    }

    const system = `You are ${this.name}, a professional writer agent. Follow the user's task exactly, including length, format, topic, and wording constraints. Write in a ${this.voice} style.`;
    const user = `Write a high-quality draft for the task: ${task}`;

    this.logger.action('writer.createDraft.start', { agent: this.name, task });
    try {
      const output = await this.provider.generate({ system, user });
      this.logger.action('writer.createDraft.complete', { agent: this.name, outputChars: output.length });
      return output;
    } catch (error) {
      this.logger.error('writer.createDraft.error', error, { agent: this.name, task });
      throw error;
    }
  }

  async refineDraft(draft, review) {
    if (!this.provider) {
      throw new Error('WriterAgent requires a provider to refine content.');
    }

    const improvements = normalizeList(
      review.improvements,
      'Improve clarity, structure, and factual grounding.'
    );

    const system = `You are ${this.name}, a professional writer agent. Improve the draft using reviewer feedback.`;
    const user = `Here is the current draft:\n${draft}\n\nReviewer feedback:\n${improvements.join('\n')}\n\nPlease provide a refined draft that incorporates the review suggestions.`;

    this.logger.action('writer.refineDraft.start', { agent: this.name, draftChars: draft.length });
    try {
      const output = await this.provider.generate({ system, user });
      this.logger.action('writer.refineDraft.complete', { agent: this.name, outputChars: output.length });
      return output;
    } catch (error) {
      this.logger.error('writer.refineDraft.error', error, { agent: this.name });
      throw error;
    }
  }
}

class ReviewerAgent extends Agent {
  constructor(provider, name = 'Reviewer') {
    super(name, 'reviewer', provider);
  }

  async reviewDraft(draft) {
    if (!this.provider) {
      throw new Error('ReviewerAgent requires a provider to review content.');
    }

    const system = `You are ${this.name}, an expert reviewer agent. Analyze the draft and provide constructive feedback in valid JSON format.`;
    const user = `Review the draft below and return only valid JSON with keys: observations, improvements, summary. Do not include any extra explanation outside the JSON object.\n\nDraft:\n${draft}`;
    this.logger.action('reviewer.reviewDraft.start', { agent: this.name, draftChars: draft.length });
    let output;
    try {
      output = await this.provider.generate({ system, user, format: 'json' });
    } catch (error) {
      this.logger.error('reviewer.reviewDraft.error', error, { agent: this.name });
      throw error;
    }

    try {
      const parsed = JSON.parse(output);
      const review = {
        observations: normalizeList(parsed.observations, 'Draft reviewed.'),
        improvements: normalizeList(parsed.improvements, 'Improve clarity and evidence.'),
        summary: String(parsed.summary || `Reviewed by ${this.name}.`)
      };
      this.logger.action('reviewer.reviewDraft.complete', {
        agent: this.name,
        observations: review.observations.length,
        improvements: review.improvements.length
      });
      return review;
    } catch (error) {
      this.logger.warn('reviewer.reviewDraft.parse_fallback', { agent: this.name, error: error.message });
      return {
        observations: ['Unable to parse review output from the provider.'],
        improvements: ['Ensure the reviewer returns valid JSON formatted output.'],
        summary: `Reviewed by ${this.name}: fallback review due to parse failure.`
      };
    }
  }
}

module.exports = {
  Agent,
  WriterAgent,
  ReviewerAgent
};
