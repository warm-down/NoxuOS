const os = require('os');
const WebSocket = require('ws');
const { createDefaultProvider } = require('./AIProvider');
const { CameraScanner } = require('./CameraScanner');
const skillRegistry = require('../config/skills.json');

class EmpireBridge {
  constructor({
    piHost = process.env.PI_HOST || 'http://pi5.local:5000',
    wsUrl = process.env.EMPIRE_WS || 'ws://pi5.local:8765',
    deviceName = process.env.DEVICE_NAME || os.hostname(),
    role = process.env.DEVICE_ROLE || 'worker',
    provider = createDefaultProvider()
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
  }

  async connect() {
    const registration = await this.buildRegistration();

    try {
      await this.registerWithController(registration);
      await this.connectAgentBus();
      return { mode: 'mesh', registration };
    } catch (error) {
      this.standalone = true;
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
  }

  connectAgentBus() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('agent bus connection timed out'));
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        this.connected = true;
        this.send({
          type: 'register',
          agent_id: this.deviceName,
          role: this.role,
          skills: skillRegistry.skills.map((skill) => skill.name)
        });
        console.log(`[EMPIRE] Connected as ${this.deviceName} (${this.role})`);
        resolve();
      });

      ws.on('message', async (data) => {
        let message = {};
        try {
          message = JSON.parse(data.toString());
          await this.handleCommand(message);
        } catch (error) {
          this.send({
            type: 'error',
            from: this.deviceName,
            task_id: message.id,
            message: error.message
          });
        }
      });

      ws.on('close', () => {
        this.connected = false;
        this.ws = null;
      });

      ws.on('error', reject);
    });
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
        this.send({ type: 'unknown_command', from: this.deviceName, command: message.command });
    }
  }

  async executeAgentTask(task) {
    const prompt = task.prompt || task.user || '';
    if (!prompt) {
      throw new Error('run_agent task requires a prompt.');
    }

    return this.provider.generate({
      system: task.system,
      user: prompt,
      temperature: task.temperature,
      maxTokens: task.maxTokens
    });
  }

  reportResult(taskId, result) {
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
    const report = await scanner.scan({ subnet: task.subnet });
    return scanner.format(report);
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
        reject(new Error(`Remote task timed out: ${command} -> ${target}`));
      }, timeoutMs);

      this.pendingTasks.set(id, { resolve, reject, timer });
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
