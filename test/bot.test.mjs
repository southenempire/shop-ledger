import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.SHOP_LEDGER_DIR = mkdtempSync(path.join(os.tmpdir(), 'shop-ledger-bot-test-'));

const { initLedger, loadLedger } = await import('../src/ledger.mjs');
const { createBot } = await import('../src/bot-core.mjs');

function harness({ heard = 'I sold three bags of rice' } = {}) {
  const calls = [];
  let ownerId = null;
  const bot = createBot({
    api: async (method, body) => { calls.push({ method, ...body }); return {}; },
    fetchVoice: async () => 'voice.oga',
    transcribe: async () => heard,
    owner: { get: async () => ownerId, set: async (id) => { ownerId = id; } },
  });
  const say = (chatId, text) => bot.handleUpdate({ message: { chat: { id: chatId }, text } });
  const tap = (chatId, data) => bot.handleUpdate({ callback_query: { id: 'cb', data, message: { chat: { id: chatId }, message_id: 7 } } });
  const last = (method) => calls.filter((c) => c.method === method).at(-1);
  return { bot, calls, say, tap, last };
}

test('the first /start claims the bot and strangers are refused', async () => {
  await initLedger({ force: true, sample: true });
  const { say, last } = harness();
  await say(1, 'hello');
  assert.match(last('sendMessage').text, /Send \/start/);
  await say(1, '/start');
  assert.match(last('sendMessage').text, /ready/);
  await say(2, '/stock');
  assert.match(last('sendMessage').text, /private/);
  await say(1, '/stock');
  assert.match(last('sendMessage').text, /Rice: 20 bag/);
});

test('a text sale is previewed, then saved only after Save is tapped', async () => {
  await initLedger({ force: true, sample: true });
  const { say, tap, last } = harness();
  await say(1, '/start');
  await say(1, 'I sold 16 bags of rice');
  assert.match(last('sendMessage').text, /Log sale\?/);
  assert.ok(last('sendMessage').reply_markup);
  assert.equal((await loadLedger()).items.rice.qty, 20, 'nothing is saved before confirmation');

  await tap(1, 'save');
  const edited = last('editMessageText').text;
  assert.match(edited, /Saved\./);
  assert.match(edited, /Low stock: Rice has 4 bag left/);
  assert.equal((await loadLedger()).items.rice.qty, 4);
});

test('Cancel saves nothing', async () => {
  await initLedger({ force: true, sample: true });
  const { say, tap, last } = harness();
  await say(1, '/start');
  await say(1, 'I sold 2 bags of garri');
  await tap(1, 'cancel');
  assert.match(last('editMessageText').text, /Cancelled/);
  assert.equal((await loadLedger()).items.garri.qty, 12);
});

test('a voice note is transcribed, echoed back and previewed', async () => {
  await initLedger({ force: true, sample: true });
  const { bot, say, tap, last } = harness({ heard: 'I sold two cartons of Indomie' });
  await say(1, '/start');
  await bot.handleUpdate({ message: { chat: { id: 1 }, voice: { file_id: 'f', duration: 4 } } });
  assert.match(last('sendMessage').text, /2 carton Indomie/);
  await tap(1, 'save');
  assert.equal((await loadLedger()).items.indomie.qty, 13);
  assert.equal((await loadLedger()).sales[0].source, 'voice');
});

test('unknown items are not logged', async () => {
  await initLedger({ force: true, sample: true });
  const { say, last } = harness();
  await say(1, '/start');
  await say(1, 'I sold 2 cartons of spaghetti');
  assert.match(last('sendMessage').text, /did not recognise/);
  assert.equal(last('sendMessage').reply_markup, undefined);
});
