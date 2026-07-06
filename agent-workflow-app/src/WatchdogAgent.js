const { execFile } = require('child_process');
const { promisify } = require('util');
const { createLogger } = require('./StructuredLogger');

const execFileAsync = promisify(execFile);
const KNOWN_PORTS = {
  53: 'DNS listener',
  135: 'Microsoft RPC endpoint mapper',
  139: 'NetBIOS session service',
  445: 'SMB file sharing',
  623: 'IPMI / Intel AMT management',
  2179: 'Hyper-V VM console',
  3389: 'Remote Desktop',
  5040: 'Windows CDP service',
  5357: 'Web Services on Devices',
  16992: 'Intel AMT web management'
};

function parseListeningEndpoint(line) {
  const parts = String(line).trim().split(/\s+/);
  const protocol = parts[0];
  const local = parts[1] || '';
  const portMatch = local.match(/:(\d+)$/);
  if (!portMatch) return null;

  const port = Number(portMatch[1]);
  const address = local.slice(0, local.length - portMatch[0].length).replace(/^\[|\]$/g, '') || '*';
  return {
    protocol,
    address,
    port,
    service: KNOWN_PORTS[port] || (port >= 49152 ? 'Windows dynamic/private port' : 'unknown'),
    exposed: ['0.0.0.0', '::', '*'].includes(address)
  };
}

function summarizeListeningPorts(lines) {
  const seen = new Map();

  for (const line of lines) {
    const parsed = parseListeningEndpoint(line);
    if (!parsed) continue;

    const key = `${parsed.protocol}:${parsed.port}:${parsed.address}`;
    if (!seen.has(key)) seen.set(key, parsed);
  }

  return [...seen.values()].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}

class WatchdogAgent {
  constructor(provider, {
    enableNetworkScan = process.env.WATCHDOG_ENABLE_NETWORK_SCAN === 'true',
    subnet = process.env.WATCHDOG_SUBNET || '192.168.1'
  } = {}) {
    this.provider = provider;
    this.enableNetworkScan = enableNetworkScan;
    this.subnet = subnet;
    this.alerts = [];
    this.logger = createLogger('watchdog');
  }

  async checkOpenPorts() {
    this.logger.action('watchdog.checkOpenPorts.start');
    try {
      const { stdout } = await execFileAsync('netstat', ['-an'], {
        windowsHide: true,
        timeout: 10000
      });

      const ports = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes('LISTENING'))
        .slice(0, 80);
      this.logger.action('watchdog.checkOpenPorts.complete', { count: ports.length });
      return ports;
    } catch (error) {
      this.logger.error('watchdog.checkOpenPorts.error', error);
      return [`Port check failed: ${error.message}`];
    }
  }

  async scanNetwork() {
    if (!this.enableNetworkScan) {
      this.logger.info('watchdog.scanNetwork.skipped', { subnet: this.subnet });
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
      this.logger.action('watchdog.scanNetwork.start', { subnet: this.subnet });
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
        windowsHide: true,
        timeout: 30000
      });

      if (!stdout.trim()) {
        this.logger.action('watchdog.scanNetwork.complete', { subnet: this.subnet, hosts: 0 });
        return [];
      }
      const parsed = JSON.parse(stdout);
      const result = Array.isArray(parsed) ? parsed : [parsed];
      this.logger.action('watchdog.scanNetwork.complete', { subnet: this.subnet, hosts: result.length });
      return result;
    } catch (error) {
      this.logger.error('watchdog.scanNetwork.error', error, { subnet: this.subnet });
      return { error: `Network scan failed: ${error.message}` };
    }
  }

  async analyzeSecurity() {
    this.logger.action('watchdog.analyzeSecurity.start');
    const openPorts = await this.checkOpenPorts();
    const openPortSummary = summarizeListeningPorts(openPorts);
    const network = await this.scanNetwork();

    const assessment = await this.provider.generate({
      system: 'You are Watchdog, a defensive security monitoring agent. Summarize local status, flag obvious risks, and suggest safe next checks. Do not imply compromise from a listening port alone.',
      user: `Open listening ports:\n${openPorts.join('\n')}\n\nPort summary:\n${JSON.stringify(openPortSummary, null, 2)}\n\nNetwork scan result:\n${JSON.stringify(network, null, 2)}\n\nGive a concise defensive security assessment.`,
      maxTokens: 320,
      temperature: 0.2
    });

    const report = {
      timestamp: new Date().toISOString(),
      openPortCount: openPorts.length,
      openPorts,
      openPortSummary,
      network,
      assessment
    };

    this.alerts.push(report);
    if (this.alerts.length > 20) this.alerts.shift();
    this.logger.action('watchdog.analyzeSecurity.complete', {
      openPortCount: openPorts.length,
      uniqueListeners: openPortSummary.length
    });
    return report;
  }

  formatReport(report) {
    const ports = (report.openPortSummary || [])
      .slice(0, 24)
      .map((item) => `${item.protocol} ${item.address}:${item.port} - ${item.service}${item.exposed ? ' (all interfaces)' : ''}`);

    return [
      'Watchdog security report:',
      `Timestamp: ${report.timestamp}`,
      `Open listening ports: ${report.openPortCount}`,
      `Unique listeners: ${(report.openPortSummary || []).length}`,
      `Network scan: ${report.network?.skipped ? report.network.reason : JSON.stringify(report.network)}`,
      ports.length ? `Port summary:\n${ports.join('\n')}` : 'Port summary: none parsed',
      '',
      report.assessment
    ].join('\n');
  }
}

module.exports = { WatchdogAgent, summarizeListeningPorts };
