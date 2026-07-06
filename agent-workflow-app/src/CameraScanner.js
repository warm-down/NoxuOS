const net = require('net');

const DEFAULT_CAMERA_PORTS = [80, 443, 554, 8080, 8888];
const DEFAULT_ALLOWED_SUBNETS = '192.168.1.0/24';

function parsePorts(value = process.env.CAMERA_SCAN_PORTS) {
  if (!value) return DEFAULT_CAMERA_PORTS;

  const ports = String(value)
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);

  return ports.length ? [...new Set(ports)] : DEFAULT_CAMERA_PORTS;
}

function normalizeSubnet(value = process.env.CAMERA_SCAN_SUBNET || process.env.WATCHDOG_SUBNET || '192.168.1.0/24') {
  const raw = String(value || '').trim();

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw)) {
    return `${raw}.0/24`;
  }

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24$/.test(raw)) {
    return raw;
  }

  throw new Error(`Only /24 IPv4 camera sweeps are supported. Got: ${raw}`);
}

function isPrivateSubnet(subnet) {
  const [base] = subnet.split('/');
  const octets = base.split('.').map(Number);
  const [a, b] = octets;

  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function subnetPrefix(subnet) {
  const normalized = normalizeSubnet(subnet);
  const octets = normalized.split('/')[0].split('.');
  return octets.slice(0, 3).join('.');
}

function parseAllowedSubnets(value = process.env.CAMERA_SCAN_ALLOWED_SUBNETS || DEFAULT_ALLOWED_SUBNETS) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeSubnet);
}

function assertAllowedSubnet(subnet, allowedSubnets = parseAllowedSubnets()) {
  const normalized = normalizeSubnet(subnet);

  if (!isPrivateSubnet(normalized)) {
    throw new Error(`Camera sweeps are limited to private subnets. Refused: ${normalized}`);
  }

  if (!allowedSubnets.includes(normalized)) {
    throw new Error(
      `Subnet ${normalized} is not in CAMERA_SCAN_ALLOWED_SUBNETS (${allowedSubnets.join(', ')}).`
    );
  }

  return normalized;
}

function connectPort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;

    const finish = (open) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return results;
}

function cameraHints(openPorts) {
  const hints = [];
  if (openPorts.includes(554)) hints.push('RTSP stream service');
  if (openPorts.some((port) => [80, 443, 8080, 8888].includes(port))) {
    hints.push('Web interface');
  }
  return hints;
}

class CameraScanner {
  constructor({
    allowedSubnets = parseAllowedSubnets(),
    ports = parsePorts(),
    timeoutMs = Number(process.env.CAMERA_SCAN_TIMEOUT_MS || 600),
    concurrency = Number(process.env.CAMERA_SCAN_CONCURRENCY || 64)
  } = {}) {
    this.allowedSubnets = allowedSubnets;
    this.ports = ports;
    this.timeoutMs = timeoutMs;
    this.concurrency = concurrency;
  }

  async scan({ subnet } = {}) {
    const normalizedSubnet = assertAllowedSubnet(subnet, this.allowedSubnets);
    const prefix = subnetPrefix(normalizedSubnet);
    const startedAt = new Date().toISOString();

    const hosts = Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`);

    const scanned = await mapWithConcurrency(hosts, this.concurrency, async (host) => {
      const openChecks = await Promise.all(
        this.ports.map(async (port) => ({
          port,
          open: await connectPort(host, port, this.timeoutMs)
        }))
      );

      const openPorts = openChecks.filter((check) => check.open).map((check) => check.port);
      if (openPorts.length === 0) return null;

      return {
        host,
        openPorts,
        hints: cameraHints(openPorts),
        web: openPorts
          .filter((port) => [80, 443, 8080, 8888].includes(port))
          .map((port) => `${port === 443 ? 'https' : 'http'}://${host}${[80, 443].includes(port) ? '' : `:${port}`}`),
        rtsp: openPorts.includes(554) ? `rtsp://${host}:554/` : null
      };
    });

    const devices = scanned.filter(Boolean);

    return {
      type: 'camera_sweep',
      startedAt,
      finishedAt: new Date().toISOString(),
      subnet: normalizedSubnet,
      ports: this.ports,
      scannedHosts: hosts.length,
      candidateCount: devices.length,
      devices,
      note: 'Authorized defensive check only. No authentication bypass or credential testing was attempted.'
    };
  }

  format(report) {
    const lines = [
      'Camera sweep report:',
      `Subnet: ${report.subnet}`,
      `Ports: ${report.ports.join(', ')}`,
      `Candidates: ${report.candidateCount}`,
      ''
    ];

    if (report.devices.length === 0) {
      lines.push('No camera-like services found on the approved subnet.');
    } else {
      for (const device of report.devices) {
        lines.push(`${device.host} ports=${device.openPorts.join(', ')} hints=${device.hints.join(', ') || 'service detected'}`);
        for (const url of device.web) lines.push(`  web: ${url}`);
        if (device.rtsp) lines.push(`  rtsp: ${device.rtsp}`);
      }
    }

    lines.push('', report.note);
    return lines.join('\n');
  }
}

module.exports = {
  CameraScanner,
  assertAllowedSubnet,
  normalizeSubnet,
  parseAllowedSubnets,
  parsePorts
};
