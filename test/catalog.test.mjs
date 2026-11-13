import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.SHOP_LEDGER_DIR = mkdtempSync(path.join(os.tmpdir(), 'shop-ledger-catalog-test-'));

const { initLedger, loadLedger, dailySummary, stockReport, dayKey } = await import('../src/ledger.mjs');
const { addItem, removeItem, setStock, teach } = await import('../src/catalog.mjs');
const { planFromText, applyPlan } = await import('../src/engine.mjs');
const { createBot } = await import('../src/bot-core.mjs');

const empty = () => ({ shop: { name: 'Test', currency: 'NGN' }, items: {}, sales: [], restocks: [], corrections: {} });

test('a new shop starts empty and says how to add items', async () => {
  await initLedger({ force: true });
  const ledger = await loadLedger();
  assert.deepEqual(ledger.items, {});
  assert.match(stockReport(ledger), /\/additem/);
});

test('/additem adds an item with aliases and sensible defaults', () => {
  const ledger = empty();
  const r = addItem(ledger, 'Garri, bags, 12, 4, 18000, gari, garri flour');
  assert.equal(r.ok, true);
  assert.deepEqual(ledger.items.garri, {
    name: 'Garri', aliases: ['garri', 'gari', 'garri flour'], unit: 'bag', qty: 12, low: 4, price: 18000,
  });
  // Only name, unit and quantity are required.
  const minimal = addItem(ledger, 'Sugar, carton, 8');
  assert.equal(minimal.ok, true);
  assert.deepEqual([ledger.items.sugar.low, ledger.items.sugar.price], [2, 0]);
});

test('/additem rejects bad input with a helpful message', () => {
  const ledger = empty();
  assert.match(addItem(ledger, '').message, /To add an item/);
  assert.match(addItem(ledger, 'Rice, sack-ish, 5').message, /do not know the unit/);
  assert.match(addItem(ledger, 'Rice, bag, lots').message, /not a number/);
  assert.match(addItem(ledger, 'Rice, bag, 5, 2, 18,000').message, /without commas/);
  addItem(ledger, 'Rice, bag, 5');
  assert.match(addItem(ledger, 'Rice, bag, 9').message, /already in your stock/);
  assert.equal(ledger.items.rice.qty, 5, 'the existing item is not overwritten');
});

test('/removeitem needs an exact name and keeps past sales readable', async () => {
  const ledger = empty();
  addItem(ledger, 'Garri, bag, 12, 4, 18000, gari');
  assert.match(removeItem(ledger, 'gar').message, /could not find/);
  assert.equal(Object.keys(ledger.items).length, 1);

  await initLedger({ force: true });
  const plan = planFromText('I sold two bags of garri', ledger);
  await applyPlan(ledger, plan);
  assert.equal(removeItem(ledger, 'Gari').ok, true);
  assert.match(dailySummary(ledger, dayKey()), /item removed/);
});

test('/setstock sets the count, tolerating small spelling errors', () => {
  const ledger = empty();
  addItem(ledger, 'Indomie, carton, 15');
  assert.equal(setStock(ledger, 'Indomie 30').ok, true);
  assert.equal(ledger.items.indomie.qty, 30);
  assert.equal(setStock(ledger, 'indomi 7').ok, true);
  assert.equal(ledger.items.indomie.qty, 7);
  assert.match(setStock(ledger, 'Indomie').message, /new count/);
  assert.match(setStock(ledger, 'Spaghetti 4').message, /could not find/);
});

test('/teach stores a correction that fixes later transcripts', async () => {
  const ledger = empty();
  addItem(ledger, 'Indomie, carton, 15');
  const before = planFromText('I sell two tukaton of Indomie', ledger);
  assert.equal(before.entries[0].unit, 'carton', 'the unit is guessed from the item anyway');

  assert.equal(teach(ledger, 'chindomi = indomie').ok, true);
  assert.equal(teach(ledger, 'tukaton means cartons').ok, true);
  assert.equal(ledger.corrections.tukaton, 'cartons');
  const plan = planFromText('I sell two tukaton of chindomi', ledger);
  assert.equal(plan.ok, true);
  assert.equal(plan.entries[0].name, 'Indomie');
  assert.equal(plan.entries[0].qty, 2);
  assert.match(teach(ledger, 'just one word').message, /Teach me a correction/);
});

test('the whole shop can be set up from Telegram commands', async () => {
  await initLedger({ force: true });
  const calls = [];
  let ownerId = null;
  const bot = createBot({
    api: async (method, body) => { calls.push({ method, ...body }); return {}; },
    fetchVoice: async () => 'v.oga',
    transcribe: async () => '',
    owner: { get: async () => ownerId, set: async (id) => { ownerId = id; } },
  });
  const say = (text) => bot.handleUpdate({ message: { chat: { id: 1 }, text } });
  const last = () => calls.filter((c) => c.method === 'sendMessage').at(-1).text;

  await say('/start');
  await say('I sold two bags of rice');
  assert.match(last(), /No items yet/);

  await say('/additem Rice, bag, 20, 5, 45000');
  assert.match(last(), /Added Rice/);
  await say('/additem');
  assert.match(last(), /To add an item/);
  await say('/setstock Rice 18');
  assert.match(last(), /Rice is now 18 bag/);
  await say('/teach tuu = two');
  assert.match(last(), /read it as "two"/);

  await say('I sold tuu bags of rice');
  assert.match(last(), /2 bag Rice \(stock: 18 -> 16\)/);

  await say('/removeitem Rice');
  assert.match(last(), /Removed Rice/);
  assert.deepEqual((await loadLedger()).items, {});
});
