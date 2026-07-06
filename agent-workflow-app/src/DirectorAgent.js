const { WriterAgent, ReviewerAgent } = require('./Agent');
const { LibrarianAgent } = require('./LibrarianAgent');
const { WatchdogAgent } = require('./WatchdogAgent');
const { WorkflowEngine } = require('./WorkflowEngine');

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
      reviewer: new ReviewerAgent(provider),
      librarian: new LibrarianAgent(provider),
      watchdog: new WatchdogAgent(provider)
    };
    this.memory = [];
    this.maxMemory = 10;
  }

  async handleCommand(userInput) {
    const input = String(userInput || '').trim();
    if (!input) {
      return 'Give me a task and I will route it.';
    }

    this.memory.push({ role: 'user', content: input });
    if (this.memory.length > this.maxMemory) this.memory.shift();

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
- librarian: file organization/search/analyze files
- watchdog: defensive monitoring, local ports, optional LAN reachability checks
- maestro: music/audio/creative production (not implemented)
- procurer: hardware/spec planning; physical actions require approval

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
      return { agent: 'librarian', task: input, response: 'Routing to Librarian.' };
    }

    if (/\b(security|scan|monitor|alert|watch|ports?|listening|network)\b/.test(lower)) {
      return { agent: 'watchdog', task: input, response: 'Routing to Watchdog.' };
    }

    if (/\b(turn on|turn off|activate|open device|close device|gpio|relay|motor|hardware)\b/.test(lower)) {
      return {
        agent: 'procurer',
        task: input,
        response: `[HARDWARE APPROVAL REQUIRED] ${input}\nPhysical device execution is not automatic. Use the supervised hardware controller after explicit approval.`
      };
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

    if (agent === 'librarian') {
      if (/\b(search|find)\b/i.test(task)) {
        const term = task.replace(/\b(search|find|files?|for)\b/gi, '').trim();
        const results = await this.agents.librarian.searchFiles(term);
        return `Librarian found ${results.length} result(s):\n${JSON.stringify(results, null, 2)}`;
      }
      return this.agents.librarian.organizeDirectory();
    }

    if (agent === 'procurer') {
      return decision.response || '[HARDWARE APPROVAL REQUIRED] Physical actions require explicit approval.';
    }

    if (agent === 'watchdog') {
      const report = await this.agents.watchdog.analyzeSecurity();
      return this.agents.watchdog.formatReport(report);
    }

    if (['maestro'].includes(agent)) {
      return `${decision.response || `${agent} is not implemented yet.`}\nQueued task: ${task}`;
    }

    return decision.response || 'I have noted your request.';
  }

  async executeWorkflow(task) {
    const engine = new WorkflowEngine({ provider: this.provider });
    const result = await engine.runWorkflow(task);
    return [
      'Workflow complete:',
      `Draft: ${result.draft.slice(0, 200)}...`,
      `Review: ${result.review.summary}`,
      `Final: ${result.finalDraft.slice(0, 200)}...`
    ].join('\n\n');
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
