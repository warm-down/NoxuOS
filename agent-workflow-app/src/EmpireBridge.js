const os = require('os');
const WebSocket = require('ws');
const { createDefaultProvider } = require('./AIProvider');
const { CameraScanner } = require('./CameraScanner');
const { createLogger } = require('./StructuredLogger');
const skillRegistry = require('../config/skills.json');

class EmpireBridge {
  constructor({
    piHost = process.env.PI_HOST || 'http://pi5.local:5000',
    wsUrl = process.env.EMPIRE_WS || 'ws://pi5.local:8765',
    deviceName = process.env.DEVICE_NAME || os.hostname(),
    role = process.env.DEVICE_ROLE || 'worker',
    provider = createDefaultProvider(),
    autoReconnect = process.env.EMPIRE_AUTO_RECONNECT !== 'false',
    reconnectDelayMs = Number(process.env.EMPIRE_RECONNECT_DELAY_MS || 5000)
  } = {}) {
    this.piHost = piHost.replace(/\/$/, '');
    this.wsUrl = wsUrl;
    this.deviceName = deviceName;
    this.role = role;
    this.provider = provider;
    this.ws = null;
    this.connected = false;
    this.standalone = false;
    this.pendingTasks = new Map();
    this.logger = createLogger('empire-bridge');
    this.autoReconnect = autoReconnect;
    this.reconnectDelayMs = reconnectDelayMs;
    this.reconnectTimer = null;
    this.closedByUser = false;
    this.connecting = false;
  }

  async connect() {
    const registration = await this.buildRegistration();

    try {
      await this.registerWithController(registration);
      await this.connectAgentBus();
      this.logger.action('empire.connect.mesh', { registration, piHost: this.piHost, wsUrl: this.wsUrl });
      return { mode: 'mesh', registration };
    } catch (error) {
      this.standalone = true;
      this.logger.error('empire.connect.standalone', error, { piHost: this.piHost, wsUrl: this.wsUrl });
      console.log(`[EMPIRE] Controller unavailable, running standalone: ${error.message}`);
      return { mode: 'standalone', registration };
    }
  }

  async buildRegistration() {
    return {
      name: this.deviceName,
      role: this.role,
      ip: this.getLocalIP(),
      models: await this.getAvailableModels(),
      skills: skillRegistry.skills.map((skill) => skill.name),
      status: 'online'
    };
  }

  async registerWithController(registration) {
    const response = await fetch(`${this.piHost}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration),
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) {
      throw new Error(`controller registration failed (${response.status})`);
    }
    this.logger.action('empire.controller.registered', { piHost: this.piHost, name: registration.name, role: registration.role });
  }

  connectAgentBus() {
    return new Promise((resolve, reject) => {
      if (this.connecting) {
        reject(new Error('agent bus connection already in progress'));
        return;
      }

      this.connecting = true;
      const ws = new WebSocket(this.wsUrl);
      let settled = false;
      const timer = setTimeout(() => {
        ws.close();
        this.connecting = false;
        settled = true;
        reject(new Error('agent bus connection timed out'));
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timer);
        this.connecting = false;
        settled = true;
        this.ws = ws;
        this.connected = true;
        this.standalone = false;
        this.send({
          type: 'register',
          agent_id: this.deviceName,
          role: this.role,
          skills: skillRegistry.skills.map((skill) => skill.name)
        });
        console.log(`[EMPIRE] Connected as ${this.deviceName} (${this.role})`);
        this.logger.action('empire.bus.connected', { wsUrl: this.wsUrl, deviceName: this.deviceName, role: this.role });
        resolve();
      });

      ws.on('message', async (data) => {
        let message = {};
        try {
          message = JSON.parse(data.toString());
          this.logger.action('empire.bus.message', {
            type: message.type,
            command: message.command,
            target: message.target,
            taskId: message.id || message.task_id
          });
          await this.handleCommand(message);
        } catch (error) {
          this.logger.error('empire.bus.message_error', error, { message });
          this.send({
            type: 'error',
            from: this.deviceName,
            task_id: message.id,
            message: error.message
          });
        }
      });

      ws.on('close', () => {
        clearTimeout(timer);
        this.connecting = false;
        this.connected = false;
        this.ws = null;
        this.logger.warn('empire.bus.closed', { wsUrl: this.wsUrl });
        this.scheduleReconnect('bus closed');
      });

      ws.on('error', (error) => {
        clearTimeout(timer);
        this.connecting = false;
        this.logger.error('empire.bus.error', error, { wsUrl: this.wsUrl });
        if (!settled) {
          settled = true;
          reject(error);
          return;
        }
        this.scheduleReconnect(error.message);
      });
    });
  }

  scheduleReconnect(reason) {
    if (!this.autoReconnect || this.closedByUser || this.reconnectTimer) return;

    this.logger.warn('empire.reconnect.scheduled', {
      reason,
      delayMs: this.reconnectDelayMs,
      piHost: this.piHost,
      wsUrl: this.wsUrl
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.closedByUser || this.connected) return;

      try {
        const registration = await this.buildRegistration();
        await this.registerWithController(registration);
        await this.connectAgentBus();
        this.logger.action('empire.reconnect.complete', { registration });
      } catch (error) {
        this.logger.error('empire.reconnect.failed', error);
        this.scheduleReconnect(error.message);
      }
    }, this.reconnectDelayMs);
  }

  async getAvailableModels() {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(2000)
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.models?.map((model) => model.name) ?? [];
    } catch (error) {
      return [];
    }
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async handleCommand(message) {
    if (message.type === 'task_complete') {
      this.resolvePendingTask(message.task_id, null, message.result);
      return;
    }

    if (message.type === 'error' && message.task_id) {
      this.resolvePendingTask(message.task_id, new Error(message.message || 'Remote task failed'));
      return;
    }

    if (message.target && message.target !== this.deviceName) return;

    switch (message.command) {
      case 'run_agent': {
        const result = await this.executeAgentTask(message.task || {});
        this.reportResult(message.id, result);
        break;
      }
      case 'camera_sweep': {
        const result = await this.executeCameraSweep(message.task || {});
        this.reportResult(message.id, result);
        break;
      }
      case 'get_status':
        await this.reportStatus();
        break;
      case 'list_skills':
        this.send({ type: 'skills', from: this.deviceName, skills: skillRegistry.skills });
        break;
      case 'migrate_agent':
        await this.migrateAgent(message.agent, message.toDevice);
        break;
      default:
        this.logger.warn('empire.command.unknown', { command: message.command, message });
        this.send({ type: 'unknown_command', from: this.deviceName, command: message.command });
    }
  }

  async executeAgentTask(task) {
    const prompt = task.prompt || task.user || '';
    if (!prompt) {
      throw new Error('run_agent task requires a prompt.');
    }

    this.logger.action('empire.task.run_agent.start', { promptChars: prompt.length, task });
    try {
      const output = await this.provider.generate({
      system: task.system,
      user: prompt,
      temperature: task.temperature,
      maxTokens: task.maxTokens
      });
      this.logger.action('empire.task.run_agent.complete', { outputChars: output.length });
      return output;
    } catch (error) {
      this.logger.error('empire.task.run_agent.error', error, { task });
      throw error;
    }
  }

  reportResult(taskId, result) {
    this.logger.action('empire.task.result', { taskId, resultChars: String(result || '').length });
    this.send({ type: 'task_complete', from: this.deviceName, task_id: taskId, result });
  }

  async reportStatus() {
    this.send({
      type: 'status',
      from: this.deviceName,
      role: this.role,
      ip: this.getLocalIP(),
      load: os.loadavg()[0],
      memory: process.memoryUsage(),
      models: await this.getAvailableModels(),
      skills: skillRegistry.skills.map((skill) => skill.name),
      standalone: this.standalone
    });
  }

  async executeCameraSweep(task) {
    if (!['security', 'worker', 'coordinator'].includes(this.role)) {
      throw new Error(`camera_sweep is not enabled for role ${this.role}`);
    }

    const scanner = new CameraScanner();
    this.logger.action('empire.cameraSweep.start', { task });
    const report = await scanner.scan({ subnet: task.subnet });
    const output = scanner.format(report);
    this.logger.action('empire.cameraSweep.complete', { subnet: report.subnet, candidates: report.candidates?.length || 0 });
    return output;
  }

  requestTask({ target, command, task = {}, timeoutMs = 60000 }) {
    if (!this.connected) {
      return Promise.reject(new Error('Empire mesh is not connected.'));
    }
    if (!target) {
      return Promise.reject(new Error('Remote task requires a target node.'));
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTasks.delete(id);
        this.logger.error('empire.task.timeout', new Error(`Remote task timed out: ${command} -> ${target}`), { id, target, command });
        reject(new Error(`Remote task timed out: ${command} -> ${target}`));
      }, timeoutMs);

      this.pendingTasks.set(id, { resolve, reject, timer });
      this.logger.action('empire.task.request', { id, target, command, task, timeoutMs });
      this.send({ id, target, command, task });
    });
  }

  resolvePendingTask(taskId, error, result) {
    const pending = this.pendingTasks.get(taskId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingTasks.delete(taskId);

    if (error) pending.reject(error);
    else pending.resolve(result);
    this.logger.action(error ? 'empire.task.rejected' : 'empire.task.resolved', {
      taskId,
      error: error?.message,
      resultChars: String(result || '').length
    });
  }

  async migrateAgent(agentName, toDevice) {
    console.log(`[EMPIRE] Migration requested for ${agentName} to ${toDevice}`);
    this.send({ type: 'migration_not_ready', from: this.deviceName, agent: agentName, toDevice });
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const [id, pending] of this.pendingTasks.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Empire bridge closed before task completed.'));
      this.pendingTasks.delete(id);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports = EmpireBridge;
