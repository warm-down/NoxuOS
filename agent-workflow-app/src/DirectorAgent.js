const { WriterAgent, ReviewerAgent } = require('./Agent');

function normalizeList(value, fallback) {
  const values = Array.isArray(value) ? value : [value || fallback];
  return values.map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') return JSON.stringify(item);
    return String(item);
  });
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

class DirectorAgent {
  constructor(provider, empireBridge) {
    this.provider = provider;
    this.empire = empireBridge;
    this.agents = {
      writer: new WriterAgent(provider),
      reviewer: new ReviewerAgent(provider)
    };
    this.memory = [];
  }

  async handleCommand(userInput) {
    const input = String(userInput || '').trim();
    if (!input) {
      return 'Give me a task and I will route it.';
    }

    this.memory.push({ role: 'user', content: input });

    if (input.toLowerCase() === 'status') {
      return this.getLocalStatus();
    }

    const decision = await this.route(input);
    const response = await this.executeDecision(decision, input);
    this.memory.push({ role: 'assistant', content: response });
    return response;
  }

  async route(input) {
    const system = `You are The Director, the central AI coordinator.
Choose the best agent for the user's request.

Available agents:
- writer: drafting, writing, editing, announcements, summaries
- reviewer: critique, review, improve, evaluate text
- librarian: file organization/search (not implemented)
- watchdog: monitoring/security status (not implemented)
- maestro: music/audio/creative production (not implemented)

Reply only as JSON: {"agent":"name","task":"description","response":"brief user-facing note"}`;

    try {
      const routing = await this.provider.generate({
        system,
        user: `User request: ${input}`,
        format: 'json',
        maxTokens: 180,
        temperature: 0
      });
      const parsed = parseJsonObject(routing);
      if (parsed?.agent) return parsed;
    } catch (error) {
      // Fall through to deterministic routing.
    }

    return this.routeWithHeuristics(input);
  }

  routeWithHeuristics(input) {
    const lower = input.toLowerCase();

    if (/\b(review|critique|check|improve|feedback)\b/.test(lower)) {
      return { agent: 'reviewer', task: input, response: 'Routing to Reviewer.' };
    }

    if (/\b(write|draft|compose|announce|summary|summarize|email|post)\b/.test(lower)) {
      return { agent: 'writer', task: input, response: 'Routing to Writer.' };
    }

    if (/\b(file|folder|organize|find|search)\b/.test(lower)) {
      return { agent: 'librarian', task: input, response: 'Librarian is queued but not implemented yet.' };
    }

    if (/\b(security|scan|monitor|alert|watch)\b/.test(lower)) {
      return { agent: 'watchdog', task: input, response: 'Watchdog is queued but not implemented yet.' };
    }

    if (/\b(music|audio|mix|song|voice)\b/.test(lower)) {
      return { agent: 'maestro', task: input, response: 'Maestro is queued but not implemented yet.' };
    }

    return { agent: 'writer', task: input, response: 'Routing to Writer by default.' };
  }

  async executeDecision(decision, originalInput) {
    const agent = String(decision.agent || '').toLowerCase();
    const task = decision.task || originalInput;

    if (agent === 'writer') {
      return this.agents.writer.createDraft(task);
    }

    if (agent === 'reviewer') {
      const review = await this.agents.reviewer.reviewDraft(task);
      return [
        'Review complete:',
        `Observations: ${normalizeList(review.observations, 'Draft reviewed.').join('; ')}`,
        `Improvements: ${normalizeList(review.improvements, 'Improve clarity.').join('; ')}`,
        `Summary: ${review.summary}`
      ].join('\n');
    }

    if (['librarian', 'watchdog', 'maestro'].includes(agent)) {
      return `${decision.response || `${agent} is not implemented yet.`}\nQueued task: ${task}`;
    }

    return decision.response || 'I have noted your request.';
  }

  async getLocalStatus() {
    const registration = this.empire
      ? await this.empire.buildRegistration()
      : { name: 'local', role: 'standalone', models: [], skills: [] };

    return [
      `Node: ${registration.name} (${registration.role})`,
      `Models: ${registration.models.length ? registration.models.join(', ') : 'none detected'}`,
      `Skills: ${registration.skills.length ? registration.skills.join(', ') : 'none loaded'}`
    ].join('\n');
  }
}

module.exports = { DirectorAgent };
