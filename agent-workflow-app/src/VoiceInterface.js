const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { DEFAULT_WAKE_WORDS, parseAgentWakeWords, parseWakeCommand, parseWakeWords } = require('./WakeWords');
const { createLogger } = require('./StructuredLogger');

function isEnabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

class VoiceInterface {
  constructor(directorAgent) {
    this.director = directorAgent;
    this.started = false;
    this.wakeWords = parseWakeWords(process.env.LOCAL_VOICE_WAKE_WORDS || process.env.VOICE_WAKE_WORDS);
    this.agentWakeWords = parseAgentWakeWords(process.env.AGENT_WAKE_WORDS);
    this.requireWakeWord = process.env.LOCAL_VOICE_REQUIRE_WAKE_WORD !== 'false';
    this.mode = process.env.LOCAL_VOICE_MODE || (process.platform === 'win32' ? 'windows' : 'cli');
    this.minConfidence = Number(process.env.LOCAL_VOICE_MIN_CONFIDENCE || 0.55);
    this.chain = Promise.resolve();
    this.lastText = '';
    this.lastTextAt = 0;
    this.logger = createLogger('local-voice');
  }

  start() {
    if (this.started) {
      console.log('[VOICE] Voice interface already running.');
      return;
    }

    this.started = true;
    this.logger.action('voice.start', {
      mode: this.mode,
      requireWakeWord: this.requireWakeWord,
      wakeWords: this.wakeWords,
      agentWakeWords: this.agentWakeWords
    });
    console.log('\n[VOICE] Wake words active:');
    console.log(`[VOICE] ${this.wakeWords.join(', ')}`);

    if (this.mode === 'windows' && process.platform === 'win32') {
      this.startWindowsSpeech();
      return;
    }

    console.log('[VOICE] CLI voice fallback active.');
    console.log('[VOICE] Type "wake up <command>" to simulate wake-word input.\n');
    this.startCLIFallback();
  }

  startCLIFallback() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const ask = () => {
      rl.question('(voice): ', async (input) => {
        await this.handleRecognizedText(input, 1);
        ask();
      });
    };

    ask();
  }

  startWindowsSpeech() {
    const scriptPath = path.join(os.tmpdir(), `noxuos-windows-speech-${process.pid}.ps1`);
    const script = `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)
Register-ObjectEvent -InputObject $recognizer -EventName SpeechRecognized -Action {
  $text = $EventArgs.Result.Text
  $confidence = $EventArgs.Result.Confidence
  if ($text) {
    $payload = @{ text = $text; confidence = $confidence } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine("NOXU_SPEECH " + $payload)
    [Console]::Out.Flush()
  }
} | Out-Null
$recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
[Console]::Out.WriteLine("NOXU_READY")
[Console]::Out.Flush()
while ($true) { Start-Sleep -Milliseconds 250 }
`;

    fs.writeFileSync(scriptPath, script, 'utf8');

    const child = spawn('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.speechProcess = child;
    console.log('[VOICE] Windows microphone listener starting...');

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data) => {
      for (const line of data.split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (line.includes('NOXU_READY')) {
          console.log('[VOICE] Windows microphone listener ready. Say a wake phrase.');
          continue;
        }
        if (!line.startsWith('NOXU_SPEECH ')) continue;

        try {
          const payload = JSON.parse(line.slice('NOXU_SPEECH '.length));
          this.logger.action('voice.recognized', { text: payload.text, confidence: payload.confidence });
          this.chain = this.chain.then(() => this.handleRecognizedText(payload.text, payload.confidence));
        } catch (error) {
          this.logger.error('voice.recognized.parse_error', error, { line });
          console.log(`[VOICE] Could not parse speech event: ${error.message}`);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data) => {
      const output = data.trim();
      if (output) {
        this.logger.warn('voice.stderr', { output });
        console.log(`[VOICE] ${output}`);
      }
    });

    child.on('exit', (code) => {
      this.logger.warn('voice.listener.exit', { code });
      console.log(`[VOICE] Windows speech listener stopped (${code}).`);
      fs.rm(scriptPath, { force: true }, () => {});
    });
  }

  async handleRecognizedText(input, confidence = 1) {
    const text = String(input || '').trim();
    if (!text) return;

    if (confidence < this.minConfidence) {
      this.logger.info('voice.ignored.low_confidence', { text, confidence });
      console.log(`[VOICE] Ignored low-confidence speech (${confidence.toFixed(2)}): ${text}`);
      return;
    }

    const now = Date.now();
    if (text === this.lastText && now - this.lastTextAt < 2500) return;
    this.lastText = text;
    this.lastTextAt = now;

    const parsed = parseWakeCommand(text, {
      wakeWords: this.wakeWords,
      agentWakeWords: this.agentWakeWords,
      requireWakeWord: this.requireWakeWord
    });

    if (!parsed.accepted) {
      this.logger.info('voice.ignored.no_wake_word', { text });
      console.log(`[VOICE] Heard without wake word: ${text}`);
      return;
    }

    const command = parsed.agent && parsed.agent !== 'director'
      ? `${parsed.agent} ${parsed.command}`
      : parsed.command;

    console.log(`[VOICE] Wake: ${parsed.wakeWord || 'direct'} | Command: ${command}`);
    this.logger.action('voice.command.dispatch', { wakeWord: parsed.wakeWord, agent: parsed.agent, command });
    try {
      const response = await this.director.handleCommand(command);
      this.logger.action('voice.command.complete', { command, outputChars: String(response || '').length });
      this.speak(response);
    } catch (error) {
      this.logger.error('voice.command.error', error, { command });
      this.speak(`Voice command failed: ${error.message}`);
    }
  }

  speak(text) {
    const output = String(text || '');
    this.logger.action('voice.speak', { outputChars: output.length, ttsEnabled: isEnabled(process.env.ENABLE_TTS) });
    console.log(`\n[VOICE] ${output.slice(0, 500)}${output.length > 500 ? '...' : ''}\n`);

    if (!isEnabled(process.env.ENABLE_TTS)) {
      return;
    }

    if (process.platform === 'win32') {
      const cleanText = output.replace(/'/g, "''").replace(/[\r\n]+/g, ' ');
      spawn('powershell', [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak('${cleanText}')`
      ], { detached: true });
    } else {
      spawn('espeak', [output]);
    }
  }
}

module.exports = VoiceInterface;
