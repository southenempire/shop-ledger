import { promises as fs } from 'node:fs';
import path from 'node:path';

// Resolved lazily so tests and deployments can set SHOP_LEDGER_DIR after import.
export const dataDir = () => process.env.SHOP_LEDGER_DIR ?? path.resolve('data');
const ledgerFile = () => path.join(dataDir(), 'ledger.json');

// Sample shop used by `init`. Edit data/ledger.json (or re-run init) for a real shop.
export const SAMPLE_LEDGER = {
  shop: { name: 'Sample Shop', currency: 'NGN' },
  items: {
    rice: { name: 'Rice', aliases: ['rice', 'bag of rice'], unit: 'bag', qty: 20, low: 5, price: 45000 },
    indomie: { name: 'Indomie', aliases: ['indomie', 'noodles', 'indomie noodles'], unit: 'carton', qty: 15, low: 4, price: 6500 },
    sugar: { name: 'Sugar', aliases: ['sugar'], unit: 'carton', qty: 8, low: 3, price: 28000 },
    garri: { name: 'Garri', aliases: ['garri', 'gari'], unit: 'bag', qty: 12, low: 4, price: 18000 },
    tomato: { name: 'Tomato paste', aliases: ['tomato paste', 'tomato', 'tin tomato'], unit: 'carton', qty: 6, low: 2, price: 21000 },
    water: { name: 'Bottled water', aliases: ['water', 'bottled water', 'pure water'], unit: 'pack', qty: 25, low: 8, price: 1800 },
  },
  sales: [],
  restocks: [],
};

export async function loadLedger() {
  try {
    return JSON.parse(await fs.readFile(ledgerFile(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('No ledger yet. Run: npm run ledger -- init');
    throw err;
  }
}

// Write to a temp file then rename, so a crash never leaves a half-written ledger.
export async function saveLedger(ledger) {
  await fs.mkdir(dataDir(), { recursive: true });
  const tmp = `${ledgerFile()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2));
  await fs.rename(tmp, ledgerFile());
}

// A new shop starts empty: every shop sells something different, and the owner adds items with /additem.
export const EMPTY_LEDGER = {
  shop: { name: 'My Shop', currency: 'NGN' },
  items: {},
  sales: [],
  restocks: [],
  corrections: {},
};

export async function initLedger({ force = false, sample = false } = {}) {
  if (!force) {
    try {
      await fs.access(ledgerFile());
      throw new Error(`${ledgerFile()} already exists. Use --force to overwrite it.`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  const fresh = structuredClone(sample ? SAMPLE_LEDGER : EMPTY_LEDGER);
  await saveLedger(fresh);
  return fresh;
}

export const dayKey = (date = new Date()) => date.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

const money = (n, currency) => `${currency} ${Math.round(n).toLocaleString('en-US')}`;

export const NO_ITEMS_HELP = 'No items yet. Add what you sell, for example:\n/additem Rice, bag, 20, 5, 45000\n(name, unit, how many you have, low-stock alert level, price per unit)';

export function stockReport(ledger) {
  if (Object.keys(ledger.items).length === 0) return NO_ITEMS_HELP;
  const lines = Object.values(ledger.items).map((it) => {
    const flag = it.qty <= 0 ? '  OUT OF STOCK' : it.qty <= it.low ? '  LOW' : '';
    return `${it.name}: ${it.qty} ${it.unit}${flag}`;
  });
  return lines.join('\n');
}

export function lowStock(ledger) {
  return Object.values(ledger.items).filter((it) => it.qty <= it.low);
}

export function dailySummary(ledger, day = dayKey()) {
  const sales = ledger.sales.filter((s) => s.day === day);
  const { currency } = ledger.shop;
  const out = [`Summary for ${day}`];

  if (sales.length === 0) {
    out.push('No sales logged.');
  } else {
    const byItem = new Map();
    let revenue = 0;
    for (const s of sales) {
      const row = byItem.get(s.itemId) ?? { qty: 0, total: 0 };
      row.qty += s.qty;
      row.total += s.total ?? 0;
      byItem.set(s.itemId, row);
      revenue += s.total ?? 0;
    }
    out.push(`Sales: ${sales.length} entries, revenue ${money(revenue, currency)}`);
    for (const [itemId, row] of byItem) {
      const it = ledger.items[itemId];
      // An item can be removed after it was sold; its past sales stay in the log.
      out.push(it
        ? `- ${row.qty} ${it.unit} ${it.name} (${money(row.total, currency)}), ${it.qty} left`
        : `- ${row.qty} ${itemId} (${money(row.total, currency)}), item removed`);
    }
  }

  const low = lowStock(ledger);
  if (low.length) {
    out.push('', 'Low-stock alerts:');
    for (const it of low) {
      out.push(it.qty <= 0 ? `- ${it.name}: OUT OF STOCK` : `- ${it.name}: ${it.qty} ${it.unit} left (alert at ${it.low})`);
    }
  }
  return out.join('\n');
}
