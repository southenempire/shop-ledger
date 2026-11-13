import { UNITS, unitOf, matchItem } from './parse.mjs';

// Owner-facing commands that change the stock list. Each one mutates the ledger it is given and
// returns { ok, message }; the caller saves the ledger when ok is true.

export const ADD_USAGE = `To add an item:
/additem name, unit, how many you have, low-stock alert level, price per unit, other names...

Example:
/additem Garri, bag, 12, 4, 18000, gari

Only the first three parts are required. Write numbers without commas (18000, not 18,000).`;

const fail = (message) => ({ ok: false, message });
const ok = (message) => ({ ok: true, message });

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const toNumber = (s) => {
  const n = Number(s);
  return s !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

// Exact match on id, name or alias. Removing the wrong item would be worse than asking again.
function findExact(ledger, text) {
  const lower = text.trim().toLowerCase();
  return Object.entries(ledger.items).find(
    ([id, it]) => id === slug(lower) || it.name.toLowerCase() === lower || it.aliases.includes(lower),
  );
}

export function addItem(ledger, argText = '') {
  const parts = argText.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return fail(ADD_USAGE);
  const [name, unitRaw, qtyRaw, lowRaw, priceRaw, ...aliases] = parts;

  const unit = unitOf(unitRaw.toLowerCase());
  if (!unit) return fail(`I do not know the unit "${unitRaw}". Use one of: ${[...UNITS].join(', ')}.`);

  const qty = toNumber(qtyRaw);
  if (qty === null) return fail(`"${qtyRaw}" is not a number of items. Write it like 12 (no commas).`);
  const low = lowRaw === undefined ? Math.max(1, Math.floor(qty / 4)) : toNumber(lowRaw);
  if (low === null) return fail(`"${lowRaw}" is not a valid low-stock level.`);
  const price = priceRaw === undefined ? 0 : toNumber(priceRaw);
  if (price === null) return fail(`"${priceRaw}" is not a valid price. Write it like 18000 (no commas).`);
  // A part that is only digits is almost always a price that was split by a comma ("18,000").
  if (aliases.some((a) => /^\d+$/.test(a))) return fail('Write numbers without commas, for example 18000 instead of 18,000.');

  const id = slug(name);
  if (!id) return fail('Please give the item a name.');
  if (ledger.items[id]) return fail(`${name} is already in your stock. Use /setstock to change how many you have, or /removeitem first.`);

  ledger.items[id] = {
    name,
    aliases: [...new Set([name.toLowerCase(), ...aliases.map((a) => a.toLowerCase())])],
    unit,
    qty,
    low,
    price,
  };
  return ok(`Added ${name}: ${qty} ${unit}, low-stock alert at ${low}, price ${price}.`);
}

export function removeItem(ledger, nameText = '') {
  if (!nameText.trim()) return fail('Say which item to remove, for example: /removeitem Garri');
  const found = findExact(ledger, nameText);
  if (!found) {
    const names = Object.values(ledger.items).map((i) => i.name).join(', ');
    return fail(`I could not find "${nameText.trim()}". Your items: ${names || 'none yet'}.`);
  }
  const [id, item] = found;
  delete ledger.items[id];
  return ok(`Removed ${item.name}. Earlier sales of it stay in your records.`);
}

export function setStock(ledger, argText = '') {
  const m = argText.trim().match(/^(.*\S)\s+(\d+(?:\.\d+)?)$/);
  if (!m) return fail('Say the item and the new count, for example: /setstock Rice 30');
  const [, nameText, qtyText] = m;
  const found = findExact(ledger, nameText) ?? (() => {
    const guess = matchItem(nameText, ledger.items);
    return guess ? [guess.id, ledger.items[guess.id]] : undefined;
  })();
  if (!found) return fail(`I could not find "${nameText}" in your stock. Add it with /additem.`);
  const [, item] = found;
  item.qty = Number(qtyText);
  return ok(`${item.name} is now ${item.qty} ${item.unit}.`);
}

// "/teach tukaton = carton": the owner fixes a word the speech model keeps getting wrong.
export function teach(ledger, argText = '') {
  const [heard, meant] = argText.split(/\s*=\s*|\s+means\s+/i).map((s) => s?.trim().toLowerCase());
  if (!heard || !meant) return fail('Teach me a correction like this:\n/teach tukaton = carton\n(what I wrongly hear = what you actually say)');
  ledger.corrections ??= {};
  ledger.corrections[heard] = meant;
  return ok(`OK. When I hear "${heard}" I will read it as "${meant}".`);
}
