import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBot } from './bot-core.mjs';
import { dataDir, dayKey } from './ledger.mjs';
import { transcribeFile, shutdownSdk } from './transcribe.mjs';

try { process.loadEnvFile('.env'); } catch { /* .env is optional if the variable is already set */ }

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN. Copy .env.example to .env and add the token from @BotFather.');
  process.exit(1);
}

// Errors are rebuilt from the description and code only, so the token in the URL never reaches a log.
async function api(method, body = {}) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`${method} failed: ${err.cause?.code ?? err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method} failed: ${data.description ?? res.status}`);
  return data.result;
}

async function fetchVoice(fileId) {
  const { file_path } = await api('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file_path}`).catch((err) => {
    throw new Error(`voice download failed: ${err.cause?.code ?? err.message}`);
  });
  if (!res.ok) throw new Error(`voice download failed: ${res.status}`);
  const out = path.join(os.tmpdir(), `shop-ledger-voice-${Date.now()}.oga`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

const ownerFile = () => path.join(dataDir(), 'owner.json');
const owner = {
  async get() {
    try { return JSON.parse(await readFile(ownerFile(), 'utf8')).chatId; } catch { return null; }
  },
  async set(chatId) {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(ownerFile(), JSON.stringify({ chatId }));
  },
};

const allowed = (process.env.ALLOWED_CHAT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// One voice note at a time: loading a speech model while another is loaded can exhaust 8 GB of RAM.
let queue = Promise.resolve();
// KEEP_VOICE=1 saves each voice note to data/voice/ (git-ignored) so speech models can be compared on real recordings.
const disposeVoice = async (file) => {
  if (!process.env.KEEP_VOICE) return rm(file, { force: true });
  await mkdir(path.join(dataDir(), 'voice'), { recursive: true });
  await rename(file, path.join(dataDir(), 'voice', path.basename(file)));
};
const transcribeQueued = (file, items) => {
  const job = queue.then(() => transcribeFile(file, { items })).finally(() => disposeVoice(file));
  queue = job.catch(() => {});
  return job;
};

const bot = createBot({ api, fetchVoice, transcribe: transcribeQueued, owner, allowed });

const me = await api('getMe');
console.log(`Connected as @${me.username}. Inference runs on this machine; messages go through Telegram.`);
if (process.argv.includes('--check')) process.exit(0);

await api('setMyCommands', {
  commands: [
    { command: 'summary', description: "Today's sales and low-stock alerts" },
    { command: 'stock', description: 'Current stock levels' },
    { command: 'additem', description: 'Add something you sell' },
    { command: 'setstock', description: 'Change how many you have' },
    { command: 'removeitem', description: 'Remove an item' },
    { command: 'teach', description: 'Fix a word I keep mishearing' },
    { command: 'help', description: 'How to use this bot' },
  ],
});

// Automatic daily summary to the owner at SUMMARY_TIME (local time, default 20:00).
const summaryTime = process.env.SUMMARY_TIME ?? '20:00';
let lastSummaryDay = null;
setInterval(async () => {
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  if (hhmm !== summaryTime || lastSummaryDay === dayKey(now)) return;
  const chatId = allowed[0] ?? (await owner.get());
  if (!chatId) return;
  lastSummaryDay = dayKey(now);
  try {
    await api('sendMessage', { chat_id: chatId, text: await bot.dailySummaryText() });
  } catch (err) {
    console.error('daily summary failed:', err.message);
  }
}, 30_000).unref();

process.on('SIGINT', async () => {
  await shutdownSdk().catch(() => {});
  process.exit(0);
});

console.log(`Listening for messages. Daily summary at ${summaryTime}. Press Ctrl+C to stop.`);
let offset = 0;
for (;;) {
  try {
    const updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    for (const update of updates) {
      offset = update.update_id + 1;
      bot.handleUpdate(update).catch((err) => console.error('update failed:', err.message));
    }
  } catch (err) {
    console.error(err.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
