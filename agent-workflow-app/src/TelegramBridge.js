const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseAgentWakeWords, parseWakeCommand, parseWakeWords } = require('./WakeWords');
const { createLogger } = require('./StructuredLogger');

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
    wakeWords = parseWakeWords(process.env.TELEGRAM_WAKE_WORDS || process.env.VOICE_WAKE_WORDS),
    agentWakeWords = parseAgentWakeWords(process.env.AGENT_WAKE_WORDS),
    requireWakeWord = isEnabled(process.env.TELEGRAM_REQUIRE_WAKE_WORD),
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
    this.wakeWords = wakeWords;
    this.agentWakeWords = agentWakeWords;
    this.requireWakeWord = requireWakeWord;
    this.logger = logger;
    this.structuredLogger = createLogger('telegram');
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
    this.structuredLogger.action('telegram.start', {
      username: me.username || me.first_name,
      voiceEnabled: this.voiceEnabled,
      ttsEnabled: this.ttsEnabled,
      requireWakeWord: this.requireWakeWord
    });

    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch (error) {
        this.logger.error(`[TELEGRAM] Poll error: ${error.message}`);
        this.structuredLogger.error('telegram.poll.error', error);
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
      this.structuredLogger.warn('telegram.chat.rejected', { chatId });
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
      this.structuredLogger.action('telegram.voice.received', { chatId, duration: message.voice.duration });
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

    const commandText = text.replace(/^\/agent\b/i, '').trim() || 'status';
    const parsed = this.parseCommand(commandText);

    if (!parsed.accepted) {
      this.structuredLogger.info('telegram.message.ignored_no_wake', { chatId, text: commandText });
      await this.sendMessage(chatId, this.wakePrompt());
      return;
    }

    this.structuredLogger.action('telegram.command.dispatch', {
      chatId,
      wakeWord: parsed.wakeWord,
      agent: parsed.agent,
      command: this.toDirectorCommand(parsed)
    });
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
    const response = await this.director.handleCommand(this.toDirectorCommand(parsed));
    this.structuredLogger.action('telegram.command.complete', { chatId, outputChars: String(response || '').length });
    await this.sendMessage(chatId, response);
    await this.maybeSendAudioReply(chatId, response);
  }

  async handleVoiceMessage(message) {
    const chatId = message.chat.id;
    const duration = Number(message.voice.duration || 0);

    if (!this.voiceEnabled) {
      this.structuredLogger.warn('telegram.voice.disabled', { chatId });
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
      this.structuredLogger.warn('telegram.voice.too_long', { chatId, duration, maxVoiceSeconds: this.maxVoiceSeconds });
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
      this.structuredLogger.action('telegram.voice.transcribed', { chatId, transcriptChars: transcript.length });

      const parsed = this.parseCommand(transcript);
      if (!parsed.accepted) {
        this.structuredLogger.info('telegram.voice.ignored_no_wake', { chatId, transcript });
        await this.sendMessage(chatId, this.wakePrompt());
        return;
      }

      this.structuredLogger.action('telegram.voice.dispatch', {
        chatId,
        wakeWord: parsed.wakeWord,
        agent: parsed.agent,
        command: this.toDirectorCommand(parsed)
      });
      const response = await this.director.handleCommand(this.toDirectorCommand(parsed));
      this.structuredLogger.action('telegram.voice.complete', { chatId, outputChars: String(response || '').length });
      await this.sendMessage(chatId, response);
      await this.maybeSendAudioReply(chatId, response);
    } catch (error) {
      this.logger.error(`[TELEGRAM] Voice failed: ${error.message}`);
      this.structuredLogger.error('telegram.voice.error', error, { chatId });
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

  parseCommand(text) {
    return parseWakeCommand(text, {
      wakeWords: this.wakeWords,
      agentWakeWords: this.agentWakeWords,
      requireWakeWord: this.requireWakeWord
    });
  }

  toDirectorCommand(parsed) {
    if (parsed.agent && parsed.agent !== 'director') {
      return `${parsed.agent} ${parsed.command}`;
    }
    return parsed.command;
  }

  wakePrompt() {
    return [
      'Listening, but I need a wake phrase first.',
      `Try: ${this.wakeWords.slice(0, 5).join(', ')}`,
      'Agent aliases: watchdog, kali, scribe, librarian, critic.'
    ].join('\n');
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
      `Wake phrases: ${this.wakeWords.slice(0, 6).join(', ')}`,
      'Agent aliases: watchdog/kali, scribe, librarian, critic.',
      'Voice: use phone dictation for instant text commands, or send Telegram voice notes with local Whisper enabled.',
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
      this.structuredLogger.action('telegram.tts.complete', { chatId, outputChars: String(text || '').length });
    } catch (error) {
      this.logger.error(`[TELEGRAM] TTS failed: ${error.message}`);
      this.structuredLogger.error('telegram.tts.error', error, { chatId });
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
