import readline from 'node:readline/promises';
import { initLedger, loadLedger, stockReport, dailySummary } from './ledger.mjs';
import { planFromText, describePlan, applyPlan } from './engine.mjs';

const USAGE = `Usage: npm run ledger -- <command>

  init [--force] [--sample]   create data/ledger.json (empty shop, or --sample for demo items)
  sale "<text>" [--yes]   log a sale or restock from text
  voice <audio file> [--yes]   transcribe a voice note on-device, then log it
  stock                   show stock levels
  summary [YYYY-MM-DD]    daily summary with low-stock alerts`;

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function handleText(text, { yes, source }) {
  const ledger = await loadLedger();
  const plan = planFromText(text, ledger);
  console.log(describePlan(plan, ledger));
  if (!plan.ok) return process.exitCode = 1;
  if (!yes && !(await confirm('Save this?'))) return console.log('Nothing saved.');
  await applyPlan(ledger, plan, { source });
  console.log('Saved.');
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));

try {
  if (cmd === 'init') {
    const sample = flags.has('--sample');
    await initLedger({ force: flags.has('--force'), sample });
    console.log(sample
      ? 'Created data/ledger.json with sample items. Edit it, or use /additem in Telegram.'
      : 'Created an empty shop in data/ledger.json. Add items with /additem in Telegram.');
  } else if (cmd === 'sale') {
    if (!args.length) throw new Error('Give the sale as text, e.g. sale "I sold 3 bags of rice"');
    await handleText(args.join(' '), { yes: flags.has('--yes'), source: 'text' });
  } else if (cmd === 'voice') {
    if (!args[0]) throw new Error('Give the path to a voice note.');
    const { transcribeFile, shutdownSdk } = await import('./transcribe.mjs');
    const ledger = await loadLedger();
    let lastPct = -1;
    const text = await transcribeFile(args[0], {
      items: ledger.items,
      onProgress: (pct) => {
        if (pct !== lastPct) process.stderr.write(`\rLoading speech model ${pct}%  `);
        lastPct = pct;
      },
    });
    process.stderr.write('\n');
    console.log(`Heard: "${text}"`);
    await shutdownSdk();
    await handleText(text, { yes: flags.has('--yes'), source: 'voice' });
  } else if (cmd === 'stock') {
    console.log(stockReport(await loadLedger()));
  } else if (cmd === 'summary') {
    console.log(dailySummary(await loadLedger(), args[0]));
  } else {
    console.log(USAGE);
    if (cmd) process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message ?? err);
  process.exitCode = 1;
}
