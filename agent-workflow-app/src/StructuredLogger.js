const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LOG_PATH = process.env.STRUCTURED_LOG_PATH || path.resolve(process.cwd(), 'logs', 'agents.jsonl');
const DEFAULT_ERROR_LOG_PATH = process.env.STRUCTURED_ERROR_LOG_PATH || path.resolve(process.cwd(), 'logs', 'errors.jsonl');
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

function appendJsonLine(filePath, entry) {
  ensureLogDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

class StructuredLogger {
  constructor(component, {
    logPath = DEFAULT_LOG_PATH,
    errorLogPath = DEFAULT_ERROR_LOG_PATH,
    deviceName = process.env.DEVICE_NAME || os.hostname()
  } = {}) {
    this.component = component;
    this.logPath = logPath;
    this.errorLogPath = errorLogPath;
    this.deviceName = deviceName;
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
      appendJsonLine(level === 'error' ? this.errorLogPath : this.logPath, entry);
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
  DEFAULT_LOG_PATH,
  DEFAULT_ERROR_LOG_PATH
};
