const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LOG_PATH = process.env.STRUCTURED_LOG_PATH || path.resolve(process.cwd(), 'logs', 'agents.jsonl');
const DEFAULT_ERROR_LOG_PATH = process.env.STRUCTURED_ERROR_LOG_PATH || path.resolve(process.cwd(), 'logs', 'errors.jsonl');
function parseNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const DEFAULT_MAX_BYTES = parseNonNegativeInteger(process.env.STRUCTURED_LOG_MAX_BYTES, 25 * 1024 * 1024);
const DEFAULT_BACKUPS = parseNonNegativeInteger(process.env.STRUCTURED_LOG_BACKUPS, 3);
const SECRET_PATTERN = /(token|secret|password|api[_-]?key|authorization|cookie)/i;

function ensureLogDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function redact(value, depth = 0) {
  if (depth > 6) return '[max-depth]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: process.env.LOG_STACK_TRACES === 'true' ? value.stack : undefined
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_PATTERN.test(key) ? '[redacted]' : redact(item, depth + 1)
    ])
  );
}

function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function rotatedPath(filePath, index) {
  return `${filePath}.${index}`;
}

function rotateLogIfNeeded(filePath, maxBytes = DEFAULT_MAX_BYTES, backups = DEFAULT_BACKUPS) {
  const safeMaxBytes = normalizePositiveInteger(maxBytes, DEFAULT_MAX_BYTES);
  const safeBackups = normalizePositiveInteger(backups, DEFAULT_BACKUPS);

  if (safeMaxBytes === 0 || !fs.existsSync(filePath)) return false;

  const stats = fs.statSync(filePath);
  if (stats.size < safeMaxBytes) return false;

  if (safeBackups === 0) {
    fs.truncateSync(filePath, 0);
    return true;
  }

  for (let index = safeBackups; index >= 1; index -= 1) {
    const current = rotatedPath(filePath, index);
    const next = rotatedPath(filePath, index + 1);

    if (!fs.existsSync(current)) continue;
    if (index === safeBackups) {
      fs.rmSync(current, { force: true });
    } else {
      fs.renameSync(current, next);
    }
  }

  fs.renameSync(filePath, rotatedPath(filePath, 1));
  return true;
}

function appendJsonLine(filePath, entry, options = {}) {
  ensureLogDir(filePath);
  rotateLogIfNeeded(filePath, options.maxBytes, options.backups);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

class StructuredLogger {
  constructor(component, {
    logPath = DEFAULT_LOG_PATH,
    errorLogPath = DEFAULT_ERROR_LOG_PATH,
    deviceName = process.env.DEVICE_NAME || os.hostname(),
    maxBytes = DEFAULT_MAX_BYTES,
    backups = DEFAULT_BACKUPS
  } = {}) {
    this.component = component;
    this.logPath = logPath;
    this.errorLogPath = errorLogPath;
    this.deviceName = deviceName;
    this.maxBytes = maxBytes;
    this.backups = backups;
  }

  write(level, event, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      event,
      device: this.deviceName,
      pid: process.pid,
      ...redact(details)
    };

    try {
      appendJsonLine(level === 'error' ? this.errorLogPath : this.logPath, entry, {
        maxBytes: this.maxBytes,
        backups: this.backups
      });
    } catch (error) {
      console.error(`[LOGGING] Failed to write ${event}: ${error.message}`);
    }

    return entry;
  }

  info(event, details = {}) {
    return this.write('info', event, details);
  }

  warn(event, details = {}) {
    return this.write('warn', event, details);
  }

  error(event, error, details = {}) {
    return this.write('error', event, { ...details, error });
  }

  action(event, details = {}) {
    return this.write('action', event, details);
  }
}

function createLogger(component, options) {
  return new StructuredLogger(component, options);
}

module.exports = {
  StructuredLogger,
  createLogger,
  redact,
  rotateLogIfNeeded,
  DEFAULT_LOG_PATH,
  DEFAULT_ERROR_LOG_PATH,
  DEFAULT_MAX_BYTES,
  DEFAULT_BACKUPS
};
