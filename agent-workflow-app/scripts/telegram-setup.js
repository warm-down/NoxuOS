require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const apiBaseUrl = (process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org').replace(/\/$/, '');

async function call(method, payload = {}) {
  const response = await fetch(`${apiBaseUrl}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.description || `${method} failed with HTTP ${response.status}`);
  }
  return data.result;
}

async function main() {
  if (!token) {
    console.log('TELEGRAM_BOT_TOKEN is not set.');
    console.log('Create a bot with @BotFather, then add this to .env:');
    console.log('TELEGRAM_BOT_TOKEN=123456:your-token-here');
    process.exit(1);
  }

  const me = await call('getMe');
  await call('deleteWebhook', { drop_pending_updates: false });
  console.log(`Bot: @${me.username || me.first_name}`);
  console.log('');
  console.log('Send a message to your bot in Telegram, then run this command again.');
  console.log('');

  const updates = await call('getUpdates', {
    timeout: 0,
    allowed_updates: ['message']
  });

  const chats = new Map();
  for (const update of updates) {
    const chat = update.message?.chat;
    if (chat) chats.set(String(chat.id), chat);
  }

  if (chats.size === 0) {
    console.log('No chats found yet.');
    return;
  }

  console.log('Detected chats:');
  for (const [id, chat] of chats.entries()) {
    const label = chat.username ? `@${chat.username}` : [chat.first_name, chat.last_name].filter(Boolean).join(' ');
    console.log(`- ${id} ${chat.type}${label ? ` ${label}` : ''}`);
  }

  const firstChatId = chats.keys().next().value;
  console.log('');
  console.log('Add this to .env for a private one-user bridge:');
  console.log(`TELEGRAM_ALLOWED_CHAT_ID=${firstChatId}`);
  console.log('');
  console.log('Then start the bridge: npm run telegram');
}

main().catch((error) => {
  console.error(`[TELEGRAM] Setup failed: ${error.message}`);
  process.exit(1);
});
