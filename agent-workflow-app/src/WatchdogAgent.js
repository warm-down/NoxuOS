const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class WatchdogAgent {
  constructor(provider, {
    enableNetworkScan = process.env.WATCHDOG_ENABLE_NETWORK_SCAN === 'true',
    subnet = process.env.WATCHDOG_SUBNET || '192.168.1'
  } = {}) {
    this.provider = provider;
    this.enableNetworkScan = enableNetworkScan;
    this.subnet = subnet;
    this.alerts = [];
  }

  async checkOpenPorts() {
    try {
      const { stdout } = await execFileAsync('netstat', ['-an'], {
        windowsHide: true,
        timeout: 10000
      });

      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes('LISTENING'))
        .slice(0, 80);
    } catch (error) {
      return [`Port check failed: ${error.message}`];
    }
  }

  async scanNetwork() {
    if (!this.enableNetworkScan) {
      return {
        skipped: true,
        reason: 'Set WATCHDOG_ENABLE_NETWORK_SCAN=true to run a local /24 ping sweep.'
      };
    }

    const script = [
      `1..254 | ForEach-Object {`,
      `  $ip = '${this.subnet}.' + $_;`,
      `  if (Test-Connection -ComputerName $ip -Count 1 -Quiet -ErrorAction SilentlyContinue) {`,
      `    [pscustomobject]@{ Address = $ip; Status = 'Reachable' }`,
      `  }`,
      `} | ConvertTo-Json`
    ].join(' ');

    try {
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
        windowsHide: true,
        timeout: 30000
      });

      if (!stdout.trim()) return [];
      const parsed = JSON.parse(stdout);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      return { error: `Network scan failed: ${error.message}` };
    }
  }

  async analyzeSecurity() {
    const openPorts = await this.checkOpenPorts();
    const network = await this.scanNetwork();

    const assessment = await this.provider.generate({
      system: 'You are Watchdog, a defensive security monitoring agent. Summarize local status, flag obvious risks, and suggest safe next checks.',
      user: `Open listening ports:\n${openPorts.join('\n')}\n\nNetwork scan result:\n${JSON.stringify(network, null, 2)}\n\nGive a concise defensive security assessment.`,
      maxTokens: 320,
      temperature: 0.2
    });

    const report = {
      timestamp: new Date().toISOString(),
      openPortCount: openPorts.length,
      openPorts,
      network,
      assessment
    };

    this.alerts.push(report);
    if (this.alerts.length > 20) this.alerts.shift();
    return report;
  }

  formatReport(report) {
    return [
      'Watchdog security report:',
      `Timestamp: ${report.timestamp}`,
      `Open listening ports: ${report.openPortCount}`,
      `Network scan: ${report.network?.skipped ? report.network.reason : JSON.stringify(report.network)}`,
      '',
      report.assessment
    ].join('\n');
  }
}

module.exports = { WatchdogAgent };
