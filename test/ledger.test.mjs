import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.SHOP_LEDGER_DIR = mkdtempSync(path.join(os.tmpdir(), 'shop-ledger-test-'));

const parseModule = await import('../src/parse.mjs');
const { extractGroups, matchItem, detectIntent } = parseModule;
const { SAMPLE_LEDGER, initLedger, loadLedger, dailySummary, dayKey } = await import('../src/ledger.mjs');
const { planFromText, applyPlan, describePlan } = await import('../src/engine.mjs');

const items = SAMPLE_LEDGER.items;

test('extracts quantity, unit and item from a plain sentence', () => {
  assert.deepEqual(extractGroups('I sell three bags of rice and two cartons of Indomie'), [
    { qty: 3, unit: 'bag', phrase: 'rice', lead: 'i sell' },
    { qty: 2, unit: 'carton', phrase: 'indomie', lead: 'and' },
  ]);
});

test('understands digits, compound numbers, dozens and light Pidgin', () => {
  assert.equal(extractGroups('I don sell 5 bag garri')[0].qty, 5);
  assert.equal(extractGroups('sold twenty five pack of water')[0].qty, 25);
  assert.equal(extractGroups('sold a dozen bottles of water')[0].qty, 12);
  assert.equal(extractGroups('I sell wan carton sugar')[0].qty, 1);
  assert.equal(extractGroups('dem buy two hundred sachet rice')[0].qty, 200);
});

test('recognises a unit word the speech model got slightly wrong', () => {
  assert.deepEqual(extractGroups('I sold two cartonous of Indomie'), [{ qty: 2, unit: 'carton', phrase: 'indomie', lead: 'i sold' }]);
});

test('finds the item when it is said before the quantity', () => {
  const { parseMessage } = parseModule;
  // Real example of how an owner actually speaks: item first, quantity after.
  assert.deepEqual(
    parseMessage('I sell, I sell. Indomie today. Two cartons.', items).lines.map(({ qty, unit, itemId }) => ({ qty, unit, itemId })),
    [{ qty: 2, unit: 'carton', itemId: 'indomie' }],
  );
  assert.deepEqual(
    parseMessage('Rice, three bags, and garri, two bags', items).lines.map(({ qty, itemId }) => ({ qty, itemId })),
    [{ qty: 3, itemId: 'rice' }, { qty: 2, itemId: 'garri' }],
  );
  // Item after the quantity still wins when both are present.
  assert.equal(parseMessage('Indomie I sold two bags of garri', items).lines[0].itemId, 'garri');
});

test('recovers quantities the speech model mishears, only when a unit follows', () => {
  const { parseMessage } = parseModule;
  const read = (t) => parseMessage(t, items).lines.map(({ qty, unit, itemId }) => ({ qty, unit, itemId }));
  // Real transcriptions of "I sell Indomie today. Two cartons."
  assert.deepEqual(read('I say Indomie today, true cartoon.'), [{ qty: 2, unit: 'carton', itemId: 'indomie' }]);
  assert.deepEqual(read('I sell tree bags of rice'), [{ qty: 3, unit: 'bag', itemId: 'rice' }]);
  // "to" on its own is not a number.
  assert.deepEqual(read('I sold rice to the customer'), []);
});

test('matches items despite small transcription errors', () => {
  assert.equal(matchItem('indomi', items).id, 'indomie');
  assert.equal(matchItem('garry', items).id, 'garri');
  assert.equal(matchItem('tomato paste', items).id, 'tomato');
  assert.equal(matchItem('spaghetti', items), null);
});

test('detects restock vs sale', () => {
  assert.equal(detectIntent('received 10 bags of rice from supplier'), 'restock');
  assert.equal(detectIntent('I sold 3 bags of rice'), 'sale');
  assert.equal(detectIntent('dem buy 3 bags of rice'), 'sale');
});

test('plan, apply, summary and low-stock alerts work end to end', async () => {
  await initLedger({ force: true, sample: true });
  const ledger = await loadLedger();

  const plan = planFromText('I sell three bags of rice and two cartons of Indomie', ledger);
  assert.equal(plan.ok, true);
  assert.match(describePlan(plan, ledger), /3 bag Rice \(stock: 20 -> 17\)/);

  await applyPlan(ledger, plan, { source: 'text' });
  assert.equal(ledger.items.rice.qty, 17);
  assert.equal(ledger.items.indomie.qty, 13);
  assert.equal(ledger.sales.length, 2);
  assert.equal(ledger.sales[0].total, 3 * 45000);

  const big = planFromText('I sold 14 bags of rice', ledger);
  await applyPlan(ledger, big);
  assert.equal(ledger.items.rice.qty, 3);
  const summary = dailySummary(ledger, dayKey());
  assert.match(summary, /Low-stock alerts/);
  assert.match(summary, /Rice: 3 bag left/);
});

test('overselling warns and clamps stock at zero', async () => {
  const ledger = await loadLedger();
  const plan = planFromText('I sold 50 bags of garri', ledger);
  assert.ok(plan.warnings.some((w) => /Only 12 bag/.test(w)));
  await applyPlan(ledger, plan);
  assert.equal(ledger.items.garri.qty, 0);
});

test('unknown items are reported, not guessed', async () => {
  const ledger = await loadLedger();
  const plan = planFromText('I sold 2 cartons of spaghetti', ledger);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.unmatched, ['2 spaghetti']);
});
