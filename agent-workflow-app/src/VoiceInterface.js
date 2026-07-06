const { spawn } = require('child_process');
const readline = require('readline');

class VoiceInterface {
  constructor(directorAgent) {
    this.director = directorAgent;
    this.started = false;
    this.wakeWords = ['alpha', 'hey alpha', 'computer', 'empire'];
  }

  start() {
    if (this.started) {
      console.log('[VOICE] Voice interface already running.');
      return;
    }

    this.started = true;
    console.log('\n[VOICE] CLI voice fallback active.');
    console.log('[VOICE] Type "Alpha <command>" to simulate wake-word input.\n');
    this.startCLIFallback();
  }

  startCLIFallback() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const ask = () => {
      rl.question('(voice): ', async (input) => {
        const lower = input.toLowerCase();
        const wakeWord = this.wakeWords.find((word) => lower.includes(word));

        if (!wakeWord) {
          console.log('[VOICE] Wake word not detected.');
          ask();
          return;
        }

        const command = input.replace(new RegExp(wakeWord, 'i'), '').trim() || 'status';
        const response = await this.director.handleCommand(command);
        this.speak(response);
        ask();
      });
    };

    ask();
  }

  speak(text) {
    const output = String(text || '');
    console.log(`\n[VOICE] ${output.slice(0, 500)}${output.length > 500 ? '...' : ''}\n`);

    if (process.env.ENABLE_TTS !== 'true') {
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
