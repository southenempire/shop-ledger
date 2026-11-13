// Rule-based parser for short sales messages, e.g.
//   "I sell three bags of rice and two cartons of Indomie"
//   "I don sell 5 bag garri"            (light Pidgin)
//   "received 10 bags of rice from supplier"
// Rules first, on purpose: a 0.6B local model is unreliable at structured output,
// and the engine asks the owner to confirm before anything is written.

const ONES = {
  zero: 0, one: 1, wan: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export const UNITS = new Set(['bag', 'carton', 'piece', 'pack', 'crate', 'tin', 'bottle', 'sachet', 'box', 'sack', 'kg', 'litre', 'liter']);
const STOP = new Set(['and', 'plus', 'then', 'with', 'for', 'to', 'at', 'from', 'today', 'yesterday', 'please', 'abeg']);
const RESTOCK = /\b(restock(?:ed)?|received?|delivery|delivered|supplier|stock in|i bought|i buy|i don buy|bring come)\b/;

const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

export const normalize = (text) =>
  text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/).filter(Boolean);

// Unit word -> canonical unit, tolerating plurals and small transcription errors ("cartonous").
export function unitOf(token = '') {
  const s = stem(token);
  if (UNITS.has(s)) return s;
  if (s.length < 5) return null;
  for (const u of UNITS) if (u.length >= 5 && editDistance(s, u) <= 2) return u;
  return null;
}

// Number words that speech models commonly produce for "two", "three", "one".
// Only trusted when a unit word follows ("true cartoon" -> 2 carton), never on their own.
const HOMOPHONES = { to: 2, too: 2, tu: 2, tew: 2, true: 2, tree: 3, free: 3, won: 1 };

// Read a quantity starting at tokens[i]. Returns { value, next } or null.
function readNumber(tokens, i) {
  const t = tokens[i];
  if (t in HOMOPHONES && unitOf(tokens[i + 1])) return { value: HOMOPHONES[t], next: i + 1 };
  if (/^\d+(\.\d+)?$/.test(t)) return withDozen(tokens, i + 1, Number(t));
  if ((t === 'a' || t === 'an') && (tokens[i + 1] === 'dozen' || UNITS.has(stem(tokens[i + 1] ?? '')))) {
    return withDozen(tokens, i + 1, 1);
  }
  if (!(t in ONES) && !(t in TENS) && t !== 'hundred') return null;

  let value = 0;
  let j = i;
  for (; j < tokens.length; j++) {
    const w = tokens[j];
    if (w in TENS) value += TENS[w];
    else if (w in ONES) value += ONES[w];
    else if (w === 'hundred') value = (value || 1) * 100;
    else break;
  }
  return withDozen(tokens, j, value);
}

function withDozen(tokens, next, value) {
  if (tokens[next] === 'dozen') return { value: value * 12, next: next + 1 };
  return { value, next };
}

// Split a message into { qty, unit, phrase } groups. Each group starts at a quantity word.
export function extractGroups(text) {
  const tokens = normalize(text);
  const groups = [];
  let i = 0;
  let prevEnd = 0;
  while (i < tokens.length) {
    const num = readNumber(tokens, i);
    if (!num) { i++; continue; }
    // Words since the previous group: the item may have been said first ("Indomie today, two cartons").
    const lead = tokens.slice(prevEnd, i).join(' ');
    let j = num.next;
    let unit = null;
    const u = unitOf(tokens[j]);
    if (u) { unit = u; j++; }
    if (tokens[j] === 'of') j++;
    const phrase = [];
    while (j < tokens.length && !STOP.has(tokens[j]) && !readNumber(tokens, j)) phrase.push(tokens[j++]);
    groups.push({ qty: num.value, unit, phrase: phrase.join(' '), lead });
    prevEnd = j;
    i = j;
  }
  return groups;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

const tolerance = (len) => (len >= 7 ? 2 : len >= 4 ? 1 : 0);

// Match a spoken item phrase to a catalog item. Handles small transcription errors
// ("indomi", "garry") through a per-token edit distance.
export function matchItem(phrase, items) {
  const words = normalize(phrase).map(stem).filter((w) => w !== 'of');
  if (words.length === 0) return null;
  let best = null;
  for (const [id, item] of Object.entries(items)) {
    for (const alias of [item.name, ...item.aliases]) {
      const aliasWords = normalize(alias).map(stem);
      const allMatch = aliasWords.every((aw) => words.some((w) => editDistance(w, aw) <= tolerance(aw.length)));
      if (!allMatch) continue;
      const exact = aliasWords.every((aw) => words.includes(aw));
      const score = (exact ? 1 : 0.8) + aliasWords.length / 100; // prefer longer, more specific aliases
      if (!best || score > best.score) best = { id, score };
    }
  }
  return best;
}

export function detectIntent(text) {
  return RESTOCK.test(text.toLowerCase()) ? 'restock' : 'sale';
}

export function parseMessage(text, items) {
  const intent = detectIntent(text);
  const lines = extractGroups(text).map((g) => {
    // Item after the quantity wins ("two cartons of Indomie"); otherwise look at what came before it.
    const m = matchItem(g.phrase, items) ?? matchItem(g.lead, items);
    return { qty: g.qty, unit: g.unit, phrase: g.phrase || g.lead, itemId: m?.id ?? null };
  });
  return { intent, lines };
}
