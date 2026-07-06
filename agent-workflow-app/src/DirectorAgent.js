const { WriterAgent, ReviewerAgent } = require('./Agent');
const { LibrarianAgent } = require('./LibrarianAgent');
const { WatchdogAgent } = require('./WatchdogAgent');
const { WorkflowEngine } = require('./WorkflowEngine');
const { createLogger } = require('./StructuredLogger');

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

function extractSubnet(input) {
  const value = String(input || '');
  const cidr = value.match(/\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.0\/24\b/);
  if (cidr) return cidr[0];

  const threeOctets = value.match(/\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\b/);
  if (threeOctets) return threeOctets[0];

  return process.env.CAMERA_SCAN_SUBNET || process.env.WATCHDOG_SUBNET || '192.168.1.0/24';
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
    this.logger = createLogger('director');
  }

  async handleCommand(userInput) {
    const input = String(userInput || '').trim();
    if (!input) {
      return 'Give me a task and I will route it.';
    }

    this.logger.action('director.command.received', { input });

    try {
      this.memory.push({ role: 'user', content: input });
      if (this.memory.length > this.maxMemory) this.memory.shift();

      if (input.toLowerCase() === 'status') {
        const status = await this.getLocalStatus();
        this.logger.action('director.command.complete', { input, agent: 'director', outputChars: status.length });
        return status;
      }

      const decision = await this.route(input);
      this.logger.action('director.route.decision', { input, decision });
      const response = await this.executeDecision(decision, input);
      this.memory.push({ role: 'assistant', content: response });
      this.logger.action('director.command.complete', {
        input,
        agent: decision.agent,
        outputChars: response.length
      });
      return response;
    } catch (error) {
      this.logger.error('director.command.error', error, { input });
      throw error;
    }
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
      this.logger.warn('director.route.llm_failed', { input, error: error.message });
    }

    return this.routeWithHeuristics(input);
  }

  routeWithHeuristics(input) {
    const lower = input.toLowerCase();

    if (/^(watchdog|security|kali)\b/.test(lower)) {
      return { agent: 'watchdog', task: input.replace(/^(watchdog|security|kali)\b/i, '').trim() || 'status', response: 'Routing to Watchdog.' };
    }

    if (/^(writer|scribe)\b/.test(lower)) {
      return { agent: 'writer', task: input.replace(/^(writer|scribe)\b/i, '').trim() || input, response: 'Routing to Writer.' };
    }

    if (/^(reviewer|critic)\b/.test(lower)) {
      return { agent: 'reviewer', task: input.replace(/^(reviewer|critic)\b/i, '').trim() || input, response: 'Routing to Reviewer.' };
    }

    if (/^(librarian|files|file keeper)\b/.test(lower)) {
      return { agent: 'librarian', task: input.replace(/^(librarian|files|file keeper)\b/i, '').trim() || input, response: 'Routing to Librarian.' };
    }

    if (/\b(cameras?|rtsp|security sweep|home security)\b/.test(lower)) {
      return { agent: 'watchdog', task: input, response: 'Routing to Watchdog security node.' };
    }

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
      return this.agents.writer.createDraft(originalInput);
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
      if (/\b(cameras?|rtsp|home security)\b/i.test(task)) {
        return this.runRemoteCameraSweep(task);
      }

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

  async runRemoteCameraSweep(task) {
    const target = process.env.SECURITY_NODE_NAME || 'Kali-XPS-Security';
    const subnet = extractSubnet(task);
    this.logger.action('director.cameraSweep.requested', { target, subnet, task });

    if (!this.empire?.connected || typeof this.empire.requestTask !== 'function') {
      this.logger.warn('director.cameraSweep.unavailable', { target, subnet });
      return [
        'Camera sweep unavailable: mesh is not connected.',
        `Target security node: ${target}`,
        `Requested subnet: ${subnet}`,
        'Run npm run bridge:check and confirm Kali is online before trying again.'
      ].join('\n');
    }

    try {
      const result = await this.empire.requestTask({
        target,
        command: 'camera_sweep',
        task: { subnet },
        timeoutMs: Number(process.env.CAMERA_SWEEP_TIMEOUT_MS || 90000)
      });

      this.logger.action('director.cameraSweep.complete', { target, subnet, outputChars: String(result).length });
      return [`Kali camera sweep via ${target}:`, result].join('\n\n');
    } catch (error) {
      this.logger.error('director.cameraSweep.error', error, { target, subnet });
      return [
        `Camera sweep failed on ${target}: ${error.message}`,
        `Requested subnet: ${subnet}`,
        'Make sure Kali is running the updated agent, and CAMERA_SCAN_ALLOWED_SUBNETS includes this subnet.'
      ].join('\n');
    }
  }
}

module.exports = { DirectorAgent, extractSubnet };
