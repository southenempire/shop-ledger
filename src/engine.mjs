import { parseMessage } from './parse.mjs';
import { dayKey, saveLedger } from './ledger.mjs';

// Two steps on purpose: planFromText() only reads, applyPlan() writes.
// The CLI and the Telegram bot show the plan and apply it after the owner says yes.

// Owner-taught fixes ("/teach tukaton = carton") applied to the transcript before parsing.
// This personalises how words are read; it does not change the speech model.
export function applyCorrections(text, corrections = {}) {
  let out = text;
  for (const [from, to] of Object.entries(corrections)) {
    out = out.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), to);
  }
  return out;
}

export function planFromText(text, ledger) {
  const { intent, lines } = parseMessage(applyCorrections(text, ledger.corrections), ledger.items);
  const entries = [];
  const unmatched = [];
  const warnings = [];

  for (const l of lines) {
    if (!l.itemId) {
      unmatched.push(l.phrase ? `${l.qty} ${l.phrase}` : String(l.qty));
      continue;
    }
    const item = ledger.items[l.itemId];
    if (l.unit && l.unit !== item.unit) {
      warnings.push(`${item.name} is counted in ${item.unit}s here, but you said ${l.unit}. Logging ${l.qty} ${item.unit}.`);
    }
    const delta = intent === 'sale' ? -l.qty : l.qty;
    if (intent === 'sale' && l.qty > item.qty) {
      warnings.push(`Only ${item.qty} ${item.unit} of ${item.name} in stock, but ${l.qty} sold. Stock will show 0.`);
    }
    entries.push({ itemId: l.itemId, name: item.name, unit: item.unit, qty: l.qty, delta });
  }

  return { intent, text, entries, unmatched, warnings, ok: entries.length > 0 };
}

export function describePlan(plan, ledger) {
  if (!plan.ok) {
    return plan.unmatched.length
      ? `I did not recognise: ${plan.unmatched.join(', ')}. Try again with an item from your stock list.`
      : 'I did not find any items and quantities. Say it like: "I sold 3 bags of rice and 2 cartons of Indomie".';
  }
  const verb = plan.intent === 'sale' ? 'Log sale' : 'Add to stock';
  const body = plan.entries.map((e) => {
    const after = Math.max(0, ledger.items[e.itemId].qty + e.delta);
    return `- ${e.qty} ${e.unit} ${e.name} (stock: ${ledger.items[e.itemId].qty} -> ${after})`;
  });
  const extra = [];
  if (plan.unmatched.length) extra.push(`Not recognised, skipped: ${plan.unmatched.join(', ')}`);
  extra.push(...plan.warnings.map((w) => `Note: ${w}`));
  return [`${verb}?`, ...body, ...extra].join('\n');
}

export async function applyPlan(ledger, plan, { source = 'text' } = {}) {
  const now = new Date();
  for (const e of plan.entries) {
    const item = ledger.items[e.itemId];
    item.qty = Math.max(0, item.qty + e.delta);
    const record = { ts: now.toISOString(), day: dayKey(now), itemId: e.itemId, qty: e.qty, unit: e.unit, source, raw: plan.text };
    if (plan.intent === 'sale') ledger.sales.push({ ...record, total: (item.price ?? 0) * e.qty });
    else ledger.restocks.push(record);
  }
  await saveLedger(ledger);
  return ledger;
}
