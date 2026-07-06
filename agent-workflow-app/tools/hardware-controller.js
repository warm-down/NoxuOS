const readline = require('readline');
const WebSocket = require('ws');

class HardwareController {
  constructor(piUrl = process.env.EMPIRE_WS || 'ws://pi5.local:8765') {
    this.piUrl = piUrl;
    this.ws = null;
    this.pendingApprovals = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.piUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('hardware bus connection timed out'));
      }, 3000);

      ws.on('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        this.ws.send(JSON.stringify({
          type: 'register',
          agent_id: 'hardware_controller',
          role: 'engineering'
        }));
        console.log('[HARDWARE] Connected to Pi 5');
        resolve();
      });

      ws.on('error', reject);
    });
  }

  async execute(device, action, requiresApproval = true) {
    if (requiresApproval) {
      const approved = await this.requestApproval(device, action);
      if (!approved) {
        console.log('[HARDWARE] Command cancelled');
        return false;
      }
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('hardware bus is not connected');
    }

    this.ws.send(JSON.stringify({
      type: 'command',
      target: device,
      payload: { action }
    }));

    return true;
  }

  requestApproval(device, action) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const timer = setTimeout(() => {
        rl.close();
        resolve(false);
      }, 30000);

      rl.question(`[HARDWARE APPROVAL] Execute "${action}" on "${device}"? (y/n): `, (answer) => {
        clearTimeout(timer);
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    });
  }
}

module.exports = HardwareController;
