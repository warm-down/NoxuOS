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

class OllamaProvider {
  constructor({
    baseUrl = 'http://127.0.0.1:11434',
    model = 'llama3.2:latest',
    temperature = 0.7,
    maxTokens = 256,
    contextWindow = 2048
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.contextWindow = contextWindow;
  }

  async generate({ system, messages = [], user, temperature, format, maxTokens } = {}) {
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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: chatMessages,
        stream: false,
        format,
        options: {
          temperature: temperature ?? this.temperature,
          num_predict: maxTokens ?? this.maxTokens,
          num_ctx: this.contextWindow
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    return data.message?.content?.trim() ?? '';
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

async function canReachOllama(baseUrl) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(1000)
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

function createDefaultProvider() {
  const provider = (process.env.AI_PROVIDER || 'auto').toLowerCase();
  const apiKey = process.env.OPENAI_API_KEY;
  const hasRealApiKey = apiKey && apiKey !== 'YOUR_OPENAI_API_KEY';
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

  if (provider === 'ollama') {
    return new OllamaProvider({
      baseUrl: ollamaBaseUrl,
      model: process.env.OLLAMA_MODEL || 'llama3.2:latest',
      temperature: Number(process.env.OLLAMA_TEMPERATURE || process.env.OPENAI_TEMPERATURE || '0.7'),
      maxTokens: Number(process.env.OLLAMA_MAX_TOKENS || '256'),
      contextWindow: Number(process.env.OLLAMA_CONTEXT_WINDOW || '2048')
    });
  }

  if (provider === 'openai' || (provider === 'auto' && hasRealApiKey)) {
    return new OpenAIProvider({
      apiKey,
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      temperature: Number(process.env.OPENAI_TEMPERATURE || '0.7')
    });
  }

  if (provider !== 'mock' && provider !== 'auto') {
    console.warn(`Unknown AI_PROVIDER "${provider}". Falling back to mock provider.`);
  } else if (provider === 'auto') {
    console.warn('No local provider was explicitly selected. Running with a mock provider. Set AI_PROVIDER=ollama to use local models.');
  }

  return new MockProvider({ temperature: Number(process.env.OPENAI_TEMPERATURE || '0.7') });
}

module.exports = {
  OpenAIProvider,
  OllamaProvider,
  MockProvider,
  canReachOllama,
  createDefaultProvider
};
