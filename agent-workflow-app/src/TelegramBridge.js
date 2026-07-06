const DEFAULT_API_BASE_URL = 'https://api.telegram.org';
const DEFAULT_MAX_MESSAGE_LENGTH = 3900;

function parseAllowedChatIds(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function splitMessage(text, maxLength = DEFAULT_MAX_MESSAGE_LENGTH) {
  const value = String(text || '');
  if (value.length <= maxLength) return [value || 'Done.'];

  const chunks = [];
  let remaining = value;

  while (remaining.length > maxLength) {
    let index = remaining.lastIndexOf('\n', maxLength);
    if (index < Math.floor(maxLength * 0.5)) {
      index = remaining.lastIndexOf(' ', maxLength);
    }
    if (index < Math.floor(maxLength * 0.5)) {
      index = maxLength;
    }

    chunks.push(remaining.slice(0, index).trimEnd());
    remaining = remaining.slice(index).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

class TelegramBridge {
  constructor({
    token = process.env.TELEGRAM_BOT_TOKEN,
    director,
    allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_ID),
    allowAll = process.env.TELEGRAM_ALLOW_ALL === 'true',
    apiBaseUrl = process.env.TELEGRAM_API_BASE_URL || DEFAULT_API_BASE_URL,
    pollTimeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS || 25),
    logger = console
  } = {}) {
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required.');
    }
    if (!director) {
      throw new Error('TelegramBridge requires a DirectorAgent.');
    }

    this.token = token;
    this.director = director;
    this.allowedChatIds = allowedChatIds;
    this.allowAll = allowAll;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.pollTimeoutSeconds = pollTimeoutSeconds;
    this.logger = logger;
    this.offset = 0;
    this.running = false;
  }

  isChatAllowed(chatId) {
    return this.allowAll || this.allowedChatIds.has(String(chatId));
  }

  async start() {
    this.running = true;
    await this.deleteWebhook();
    const me = await this.call('getMe');
    this.logger.log(`[TELEGRAM] Connected as @${me.username || me.first_name}`);
    this.logger.log('[TELEGRAM] Long polling started.');

    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch (error) {
        this.logger.error(`[TELEGRAM] Poll error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  stop() {
    this.running = false;
  }

  async deleteWebhook() {
    await this.call('deleteWebhook', { drop_pending_updates: false });
  }

  async getUpdates() {
    return this.call('getUpdates', {
      offset: this.offset,
      timeout: this.pollTimeoutSeconds,
      allowed_updates: ['message']
    });
  }

  async handleUpdate(update) {
    const message = update.message;
    if (!message || !message.chat || !message.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (!this.isChatAllowed(chatId)) {
      this.logger.log(`[TELEGRAM] Rejected chat ${chatId}`);
      await this.sendMessage(
        chatId,
        [
          'This NoxuOS agent is locked.',
          `Add this to .env on the main agent: TELEGRAM_ALLOWED_CHAT_ID=${chatId}`,
          'Then restart npm run telegram.'
        ].join('\n')
      );
      return;
    }

    if (/^\/(start|help)\b/i.test(text)) {
      await this.sendMessage(chatId, this.helpText(chatId));
      return;
    }

    if (/^\/id\b/i.test(text)) {
      await this.sendMessage(chatId, `Chat ID: ${chatId}`);
      return;
    }

    if (/^\/status\b/i.test(text)) {
      await this.sendMessage(chatId, await this.director.handleCommand('status'));
      return;
    }

    const command = text.replace(/^\/agent\b/i, '').trim() || 'status';

    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
    const response = await this.director.handleCommand(command);
    await this.sendMessage(chatId, response);
  }

  helpText(chatId) {
    return [
      'NoxuOS Telegram bridge online.',
      `Chat ID: ${chatId}`,
      '',
      'Send any message to route it through The Director.',
      'Commands:',
      '/status - local agent status',
      '/id - show this chat ID',
      '/help - show this help',
      '',
      'Hardware actions stay supervised and require explicit approval.'
    ].join('\n');
  }

  async sendMessage(chatId, text) {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await this.call('sendMessage', {
        chat_id: chatId,
        text: chunk,
        link_preview_options: { is_disabled: true }
      });
    }
  }

  async call(method, payload = {}) {
    const response = await fetch(`${this.apiBaseUrl}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout((this.pollTimeoutSeconds + 10) * 1000)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.description || `${method} failed with HTTP ${response.status}`);
    }

    return data.result;
  }
}

module.exports = {
  TelegramBridge,
  parseAllowedChatIds,
  splitMessage
};
