const { OpenAI } = require('openai');

class OpenAIProvider {
  constructor({ apiKey, model = 'gpt-4.1-mini', temperature = 0.7 } = {}) {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required to use OpenAIProvider.');
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.temperature = temperature;
  }

  async generate({ system, messages = [], user, temperature } = {}) {
    const chatMessages = [];
    if (system) {
      chatMessages.push({ role: 'system', content: system });
    }
    if (messages.length) {
      chatMessages.push(...messages);
    }
    if (user) {
      chatMessages.push({ role: 'user', content: user });
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: chatMessages,
      temperature: temperature ?? this.temperature,
      max_tokens: 1024
    });

    return response.choices?.[0]?.message?.content?.trim() ?? '';
  }
}

class MockProvider {
  constructor({ temperature = 0.7 } = {}) {
    this.temperature = temperature;
  }

  async generate({ system = '', user = '' } = {}) {
    const lower = user.toLowerCase();

    if (lower.includes('review the draft')) {
      return JSON.stringify({
        observations: [
          'The draft is clear and focused, but it could use a more engaging introduction.',
          'The message could better highlight the benefits of the new feature.'
        ],
        improvements: [
          'Add a compelling opening sentence that connects with the user problem.',
          'Emphasize the main benefit of the AI-powered operating system feature.',
          'Include a short summary of what makes the feature unique.'
        ],
        summary: 'Reviewed by mock reviewer: the draft is strong but can be improved with a sharper introduction and clearer benefit statements.'
      }, null, 2);
    }

    if (lower.includes('provide a refined draft') || lower.includes('refine the draft') || lower.includes('refined draft')) {
      return `Revised according to reviewer feedback:\n${user}\n\nThe final draft now has a clearer structure, stronger opening language, and a sharper focus on the feature benefit.`;
    }

    if (lower.includes('write a high-quality draft') || lower.includes('create a product announcement')) {
      return `This is an AI-generated draft for the task:\n${user}\n\nThe new AI-powered operating system feature delivers smarter, faster, and more intuitive interactions by combining on-device intelligence with seamless cloud-powered experiences.`;
    }

    return `Mock response for user prompt: ${user}`;
  }
}

function createDefaultProvider() {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      temperature: Number(process.env.OPENAI_TEMPERATURE || '0.7')
    });
  }

  console.warn('No OPENAI_API_KEY found. Running with a mock provider. Set OPENAI_API_KEY to connect to OpenAI.');
  return new MockProvider({ temperature: Number(process.env.OPENAI_TEMPERATURE || '0.7') });
}

module.exports = {
  OpenAIProvider,
  MockProvider,
  createDefaultProvider
};
