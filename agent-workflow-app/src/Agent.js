class Agent {
  constructor(name, role, provider) {
    this.name = name;
    this.role = role;
    this.provider = provider;
  }

  get metadata() {
    return { name: this.name, role: this.role };
  }
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

    const system = `You are ${this.name}, a professional writer agent. Write a polished, audience-focused announcement in a ${this.voice} style.`;
    const user = `Write a high-quality draft for the task: ${task}`;

    return this.provider.generate({ system, user });
  }

  async refineDraft(draft, review) {
    if (!this.provider) {
      throw new Error('WriterAgent requires a provider to refine content.');
    }

    const system = `You are ${this.name}, a professional writer agent. Improve the draft using reviewer feedback.`;
    const user = `Here is the current draft:\n${draft}\n\nReviewer feedback:\n${review.improvements.join('\n')}\n\nPlease provide a refined draft that incorporates the review suggestions.`;

    return this.provider.generate({ system, user });
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
    const output = await this.provider.generate({ system, user });

    try {
      return JSON.parse(output);
    } catch (error) {
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
