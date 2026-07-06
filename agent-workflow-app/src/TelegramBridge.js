const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const DEFAULT_API_BASE_URL = 'https://api.telegram.org';
const DEFAULT_MAX_MESSAGE_LENGTH = 3900;
const execFileAsync = promisify(execFile);

function isEnabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

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
    voiceEnabled = isEnabled(process.env.TELEGRAM_VOICE_ENABLED),
    ttsEnabled = isEnabled(process.env.TELEGRAM_REPLY_AUDIO),
    maxVoiceSeconds = Number(process.env.TELEGRAM_MAX_VOICE_SECONDS || 120),
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
    this.voiceEnabled = voiceEnabled;
    this.ttsEnabled = ttsEnabled;
    this.maxVoiceSeconds = maxVoiceSeconds;
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
    if (!message || !message.chat) return;

    const chatId = message.chat.id;

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

    if (message.voice) {
      await this.handleVoiceMessage(message);
      return;
    }

    if (!message.text) return;

    const text = message.text.trim();

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
    await this.maybeSendAudioReply(chatId, response);
  }

  async handleVoiceMessage(message) {
    const chatId = message.chat.id;
    const duration = Number(message.voice.duration || 0);

    if (!this.voiceEnabled) {
      await this.sendMessage(
        chatId,
        [
          'Voice notes are received, but local transcription is disabled.',
          'Fast path: use your phone keyboard dictation so Telegram sends text.',
          'Local Whisper path: set TELEGRAM_VOICE_ENABLED=true and install Whisper plus ffmpeg on the main agent.'
        ].join('\n')
      );
      return;
    }

    if (duration > this.maxVoiceSeconds) {
      await this.sendMessage(chatId, `Voice note is too long (${duration}s). Limit: ${this.maxVoiceSeconds}s.`);
      return;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noxuos-telegram-voice-'));

    try {
      await this.sendMessage(chatId, 'Voice received. Transcribing...');
      await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });

      const voicePath = await this.downloadTelegramFile(message.voice.file_id, tempDir);
      const transcript = await this.transcribeVoice(voicePath);

      if (!transcript) {
        throw new Error('Whisper produced an empty transcript.');
      }

      await this.sendMessage(chatId, `Heard: ${transcript}`);
      const response = await this.director.handleCommand(transcript);
      await this.sendMessage(chatId, response);
      await this.maybeSendAudioReply(chatId, response);
    } catch (error) {
      this.logger.error(`[TELEGRAM] Voice failed: ${error.message}`);
      await this.sendMessage(
        chatId,
        [
          `Voice command failed: ${error.message}`,
          'Use phone dictation to send text, or install/configure Whisper on the main agent.'
        ].join('\n')
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
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
      'Voice: use phone dictation for instant text commands, or enable local Whisper for Telegram voice notes.',
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

  async downloadTelegramFile(fileId, tempDir) {
    const file = await this.call('getFile', { file_id: fileId });
    if (!file.file_path) {
      throw new Error('Telegram did not return a downloadable file path.');
    }

    const response = await fetch(`${this.apiBaseUrl}/file/bot${this.token}/${file.file_path}`, {
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Voice download failed with HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = path.basename(file.file_path) || `${fileId}.ogg`;
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  async transcribeVoice(filePath) {
    const command = process.env.TELEGRAM_WHISPER_COMMAND || process.env.WHISPER_COMMAND || 'whisper';
    const model = process.env.TELEGRAM_WHISPER_MODEL || process.env.WHISPER_MODEL || 'base';
    const language = process.env.TELEGRAM_WHISPER_LANGUAGE || process.env.WHISPER_LANGUAGE || '';
    const fp16 = process.env.TELEGRAM_WHISPER_FP16 || 'False';
    const timeout = Number(process.env.TELEGRAM_WHISPER_TIMEOUT_MS || 120000);
    const outputDir = path.dirname(filePath);
    const basename = path.basename(filePath, path.extname(filePath));
    const transcriptPath = path.join(outputDir, `${basename}.txt`);

    const args = [
      filePath,
      '--model',
      model,
      '--output_format',
      'txt',
      '--output_dir',
      outputDir,
      '--fp16',
      fp16
    ];

    if (language) args.push('--language', language);

    await execFileAsync(command, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      timeout,
      maxBuffer: 10 * 1024 * 1024
    });

    return (await fs.readFile(transcriptPath, 'utf8')).trim();
  }

  async maybeSendAudioReply(chatId, text) {
    if (!this.ttsEnabled) return;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noxuos-telegram-tts-'));
    const audioPath = path.join(tempDir, 'reply.wav');

    try {
      await this.createTtsAudio(text, audioPath);
      await this.sendAudioFile(chatId, audioPath, 'NoxuOS response');
    } catch (error) {
      this.logger.error(`[TELEGRAM] TTS failed: ${error.message}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async createTtsAudio(text, audioPath) {
    const maxChars = Number(process.env.TELEGRAM_TTS_MAX_CHARS || 900);
    const spoken = String(text || 'Done.').replace(/\s+/g, ' ').slice(0, maxChars);
    const textPath = path.join(path.dirname(audioPath), 'reply.txt');
    await fs.writeFile(textPath, spoken, 'utf8');

    if (process.platform === 'win32') {
      const script = [
        `$text = Get-Content -Raw -LiteralPath ${quotePowerShell(textPath)}`,
        'Add-Type -AssemblyName System.Speech',
        '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        `$synth.SetOutputToWaveFile(${quotePowerShell(audioPath)})`,
        '$synth.Speak($text)',
        '$synth.Dispose()'
      ].join('; ');

      await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 1024 * 1024
      });
      return;
    }

    await execFileAsync('espeak', ['-w', audioPath, spoken], {
      timeout: 60000,
      maxBuffer: 1024 * 1024
    });
  }

  async sendAudioFile(chatId, filePath, caption) {
    const buffer = await fs.readFile(filePath);
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const form = new FormData();

    form.append('chat_id', String(chatId));
    form.append('audio', blob, path.basename(filePath));
    if (caption) form.append('caption', String(caption).slice(0, 1024));

    await this.callMultipart('sendAudio', form);
  }

  async callMultipart(method, form) {
    const response = await fetch(`${this.apiBaseUrl}/bot${this.token}/${method}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.description || `${method} failed with HTTP ${response.status}`);
    }

    return data.result;
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
