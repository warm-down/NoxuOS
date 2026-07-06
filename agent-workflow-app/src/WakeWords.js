const DEFAULT_WAKE_WORDS = [
  'wake up',
  'yo empire',
  'hey empire',
  'oi empire',
  'hey noxu',
  'yo noxu',
  'my boy',
  "what's up my boy",
  'whats up my boy',
  'alpha'
];

const DEFAULT_AGENT_WAKE_WORDS = {
  director: DEFAULT_WAKE_WORDS,
  watchdog: ['watchdog', 'security', 'kali', 'camera check', 'home security'],
  writer: ['writer', 'scribe', 'write this'],
  reviewer: ['reviewer', 'critic', 'check this'],
  librarian: ['librarian', 'files', 'file keeper'],
  maestro: ['maestro', 'music', 'audio'],
  procurer: ['procurer', 'hardware']
};

function parseWakeWords(value) {
  const source = value || process.env.VOICE_WAKE_WORDS || process.env.TELEGRAM_WAKE_WORDS;
  if (!source) return DEFAULT_WAKE_WORDS;

  const words = String(source)
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);

  return words.length ? words : DEFAULT_WAKE_WORDS;
}

function parseAgentWakeWords(value = process.env.AGENT_WAKE_WORDS) {
  if (!value) return DEFAULT_AGENT_WAKE_WORDS;

  try {
    const parsed = JSON.parse(value);
    return Object.fromEntries(
      Object.entries({ ...DEFAULT_AGENT_WAKE_WORDS, ...parsed }).map(([agent, words]) => [
        agent,
        Array.isArray(words)
          ? words.map((word) => String(word).trim().toLowerCase()).filter(Boolean)
          : String(words)
            .split(',')
            .map((word) => word.trim().toLowerCase())
            .filter(Boolean)
      ])
    );
  } catch {
    return DEFAULT_AGENT_WAKE_WORDS;
  }
}

function parseWakeCommand(input, {
  wakeWords = parseWakeWords(),
  requireWakeWord = false,
  agentWakeWords = parseAgentWakeWords()
} = {}) {
  const text = String(input || '').trim();
  if (!text) {
    return { accepted: false, command: '', wakeWord: null, agent: null };
  }

  const lower = text.toLowerCase();
  const agentMatches = Object.entries(agentWakeWords)
    .flatMap(([agent, words]) => words.map((word) => ({ agent, word })))
    .filter(({ word }) => lower.includes(word.toLowerCase()))
    .sort((a, b) => b.word.length - a.word.length);

  const fallbackWakeWord = wakeWords.find((word) => lower.includes(word.toLowerCase()));
  const match = agentMatches[0] || (fallbackWakeWord ? { agent: 'director', word: fallbackWakeWord } : null);

  if (!match) {
    return {
      accepted: !requireWakeWord,
      command: requireWakeWord ? '' : text,
      wakeWord: null,
      agent: null
    };
  }

  const index = lower.indexOf(match.word.toLowerCase());
  const command = text
    .slice(index + match.word.length)
    .replace(/^[\s,.:;!?-]+/, '')
    .trim();

  return {
    accepted: true,
    command: command || 'status',
    wakeWord: match.word,
    agent: match.agent
  };
}

module.exports = {
  DEFAULT_AGENT_WAKE_WORDS,
  DEFAULT_WAKE_WORDS,
  parseAgentWakeWords,
  parseWakeWords,
  parseWakeCommand
};
