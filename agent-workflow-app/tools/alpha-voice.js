const { spawn } = require('child_process');
const readline = require('readline');

class AlphaVoice {
  constructor(directorAgent) {
    this.director = directorAgent;
    this.wakeWords = ['alpha', 'hey alpha', 'commander'];
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
          console.log('[ALPHA] Say "Alpha" to activate');
          ask();
          return;
        }

        const command = input.replace(new RegExp(wakeWord, 'i'), '').trim();
        const response = await this.director.handleCommand(command || 'status');
        this.speak(response);
        ask();
      });
    };

    console.log('[ALPHA] CLI voice fallback active. Type "Alpha <command>".');
    ask();
  }

  speak(text) {
    console.log(`[ALPHA] ${text}`);

    if (process.env.ALPHA_TTS !== 'true') {
      return;
    }

    if (process.platform === 'win32') {
      const escaped = String(text).replace(/'/g, "''");
      spawn('powershell', [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${escaped}')`
      ]);
    } else {
      spawn('espeak', [String(text)]);
    }
  }
}

module.exports = AlphaVoice;
