import { loadLedger, saveLedger, stockReport, dailySummary, NO_ITEMS_HELP } from './ledger.mjs';
import { planFromText, describePlan, applyPlan } from './engine.mjs';
import { addItem, removeItem, setStock, teach } from './catalog.mjs';

const HELP = `Send me a voice note or a message about your sales, for example:
"I sold three bags of rice and two cartons of Indomie"

I will show you what I understood. Tap Save to log it.
To add stock, say "received 10 bags of rice".

/stock - current stock levels
/summary - today's sales and low-stock alerts

Set up your shop:
/additem - add something you sell
/setstock - change how many you have
/removeitem - remove an item
/teach - fix a word I keep mishearing`;

// Commands that change the stock list or corrections: name -> function(ledger, argText).
const EDIT_COMMANDS = { '/additem': addItem, '/removeitem': removeItem, '/setstock': setStock, '/teach': teach };

const KEYBOARD = { inline_keyboard: [[{ text: 'Save', callback_data: 'save' }, { text: 'Cancel', callback_data: 'cancel' }]] };
const MAX_VOICE_SECONDS = 120;

// All Telegram and speech I/O is injected, so the conversation logic can be tested without a network.
export function createBot({ api, fetchVoice, transcribe, owner, allowed = [] }) {
  const pending = new Map(); // chatId -> { plan, text, source }
  const send = (chat_id, text, extra = {}) => api('sendMessage', { chat_id, text, ...extra });

  // true = allowed, false = refused, null = nobody has claimed the bot yet.
  async function authorize(chatId, claiming) {
    if (allowed.length) return allowed.includes(String(chatId));
    const current = await owner.get();
    if (current) return String(current) === String(chatId);
    if (claiming) {
      await owner.set(chatId);
      return true;
    }
    return null;
  }

  async function present(chatId, text, source) {
    const ledger = await loadLedger();
    if (Object.keys(ledger.items).length === 0) return send(chatId, NO_ITEMS_HELP);
    const plan = planFromText(text, ledger);
    const message = describePlan(plan, ledger);
    if (!plan.ok) return send(chatId, message);
    pending.set(String(chatId), { plan, text, source });
    return send(chatId, message, { reply_markup: KEYBOARD });
  }

  async function onCallback(cq) {
    const chatId = cq.message.chat.id;
    await api('answerCallbackQuery', { callback_query_id: cq.id });
    if ((await authorize(chatId, false)) !== true) return;
    const entry = pending.get(String(chatId));
    const edit = (text) => api('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text });
    if (!entry) return edit('That entry has expired. Please send it again.');
    pending.delete(String(chatId));
    if (cq.data === 'cancel') return edit('Cancelled. Nothing saved.');

    const ledger = await loadLedger();
    await applyPlan(ledger, entry.plan, { source: entry.source });
    const lines = ['Saved.'];
    const low = entry.plan.entries
      .map((e) => ledger.items[e.itemId])
      .filter((it, i, all) => it.qty <= it.low && all.indexOf(it) === i);
    for (const it of low) {
      lines.push(it.qty <= 0 ? `Low stock: ${it.name} is OUT OF STOCK.` : `Low stock: ${it.name} has ${it.qty} ${it.unit} left (alert at ${it.low}).`);
    }
    return edit(lines.join('\n'));
  }

  async function onVoice(chatId, voice) {
    if (voice.duration > MAX_VOICE_SECONDS) return send(chatId, 'That voice note is too long. Please keep it under 2 minutes.');
    await send(chatId, 'Listening...');
    let text;
    try {
      const file = await fetchVoice(voice.file_id);
      text = await transcribe(file, (await loadLedger()).items);
    } catch (err) {
      console.error('voice failed:', err.message);
      return send(chatId, 'Sorry, I could not process that voice note. Please try again or type it.');
    }
    console.log(`heard: ${text}`); // local terminal only; helps tune the parser against real speech
    if (!text) return send(chatId, 'I could not hear anything. Please try again.');
    await send(chatId, `I heard: "${text}"`);
    return present(chatId, text, 'voice');
  }

  async function onMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    const command = text?.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;

    const ok = await authorize(chatId, command === '/start');
    if (ok === null) return send(chatId, 'Send /start to link this bot to your shop.');
    if (ok === false) return send(chatId, 'Sorry, this bot is private.');

    if (command === '/start') return send(chatId, `Shop Ledger is ready.\n\n${HELP}`);
    if (command === '/help') return send(chatId, HELP);
    if (command === '/stock') return send(chatId, stockReport(await loadLedger()));
    if (command === '/summary') return send(chatId, dailySummary(await loadLedger()));
    if (command in EDIT_COMMANDS) {
      const space = text.indexOf(' ');
      const argText = space === -1 ? '' : text.slice(space + 1);
      const ledger = await loadLedger();
      const result = EDIT_COMMANDS[command](ledger, argText);
      if (result.ok) await saveLedger(ledger);
      return send(chatId, result.message);
    }
    if (command) return send(chatId, 'I do not know that command. Try /help.');

    const voice = msg.voice ?? msg.audio;
    if (voice) return onVoice(chatId, voice);
    if (text) return present(chatId, text, 'text');
  }

  return {
    async handleUpdate(update) {
      if (update.callback_query) return onCallback(update.callback_query);
      if (update.message) return onMessage(update.message);
    },
    async dailySummaryText() {
      return dailySummary(await loadLedger());
    },
  };
}
