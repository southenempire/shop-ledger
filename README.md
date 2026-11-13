# Shop Ledger

A Telegram assistant that keeps sales records for small shop owners who would never
fill in a spreadsheet. The owner sends a voice note such as

> "I sold three bags of rice and two cartons of Indomie"

and the assistant transcribes it **on the shop's own computer**, shows what it understood,
logs the sale after the owner taps **Save**, updates stock, warns when items run low, and
sends a daily summary.

Built with the [QVAC SDK](https://docs.qvac.tether.io/sdk/js-ts-sdk/) for the Tether x GAIC
Advanced AI Foundations Bootcamp.

## How it works

```
voice note (Telegram) -> ffmpeg -> QVAC Whisper (on-device) -> rule-based parser
        -> preview with Save / Cancel -> ledger.json -> low-stock alert + daily summary
```

- **Speech-to-text runs locally** with QVAC (`WHISPER_EN_BASE_Q8_0`). The audio is never sent to a
  transcription service.
- **Telegram still needs the internet.** The voice note travels through Telegram's servers to reach
  the bot, and replies come back the same way. Only the AI inference is local.
- **Rules, not an LLM, extract the sale.** A small local model is unreliable at structured output,
  so a rule-based parser reads quantity, unit and item, and tolerates small transcription errors
  ("indomi", "cartonous"). The owner confirms every entry before it is saved.
- **Nothing is saved without a tap on Save.** Unknown items are reported instead of guessed, and
  overselling is flagged with a warning.

## Requirements

- Node.js 22.21.x
- [ffmpeg](https://ffmpeg.org/download.html) (macOS: `brew install ffmpeg`)
- 8 GB RAM or more
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Internet for the first run (npm packages and the speech model download) and for Telegram

## Setup

```bash
npm install
cp .env.example .env        # then paste your bot token into .env
npm run ledger -- init      # creates an empty shop (add --sample for demo items)
npm run bot
```

Open your bot in Telegram and send `/start`. **The first person to send `/start` becomes the
owner**; everyone else is refused. To restrict it in advance, set `ALLOWED_CHAT_IDS` in `.env`.

Every shop sells different things, so a new shop starts **empty**. Add what you sell from Telegram:

```
/additem Garri, bag, 12, 4, 18000, gari
```

That is: name, unit, how many you have, low-stock alert level, price per unit, then any other names
you might say. Only the first three parts are required, and numbers are written without commas.
Units: bag, carton, piece, pack, crate, tin, bottle, sachet, box, sack, kg, litre.

Everything is stored in `data/ledger.json`, which you can also edit by hand.

## Using the bot

| You send | The bot does |
|---|---|
| A voice note or text, "I sold 3 bags of rice and 2 cartons of Indomie" | Shows the entry and stock change, logs it after Save |
| "Received 10 bags of rice" | Adds to stock after Save |
| `/stock` | Current stock levels, with low items flagged |
| `/summary` | Today's sales, revenue and low-stock alerts |
| `/additem Rice, bag, 20, 5, 45000` | Adds an item to your stock list |
| `/setstock Rice 30` | Sets how many you have, for example after counting |
| `/removeitem Rice` | Removes an item (past sales stay in the records) |
| `/teach tukaton = carton` | Fixes a word the speech model keeps getting wrong |
| `/help` | Usage help |

`/teach` personalises how transcripts are read for your shop. It does **not** train or change the
speech model.

A daily summary is also sent to the owner at 20:00 local time (`SUMMARY_TIME` in `.env`).

## Command line (no Telegram needed)

```bash
npm run ledger -- sale "I sold three bags of rice" --yes
npm run ledger -- voice path/to/voice-note.ogg
npm run ledger -- stock
npm run ledger -- summary
```

## Tests

```bash
npm test
```

22 automated tests cover the parser (numbers, units, item-before-quantity phrasing, mishearing
recovery, fuzzy item matching), the ledger and summary, the stock-setup and `/teach` commands, and
whole bot conversations with the Telegram and speech layers faked.
The speech step and the Telegram bot were also tested by hand on macOS (Apple M1, 8 GB RAM,
Node 22.21.1, `@qvac/sdk` 0.22.0). The automated speech test used a synthetic macOS voice; the
Telegram test used a real voice note.

## Known issues

- **Pidgin is only partly supported.** Whisper has no Pidgin mode, so speech is transcribed as
  English, and the parser knows only a few Pidgin words ("wan", "I don sell"). Heavy Pidgin will
  be misheard.
- **English only.** The default speech model is the English `WHISPER_EN_SMALL_Q8_0`, and the parser
  knows English number words, units and phrases. Other languages would need a speech model plus a
  word pack for numbers, units and verbs; that is not built yet. Item names can be anything you put
  in the aliases, but the sentence around them must be English.
- **Accents vary a lot.** Different voices produce different transcripts. The preview before saving
  and `/teach` are the safety nets. Setting `KEEP_VOICE=1` saves voice notes to `data/voice/` so
  models can be compared on real recordings.
- **The parser reads "two bags of rice" and "rice, two bags"**, but not unusual orderings.
- **Units are not converted.** If you say "sacks" for an item counted in bags, the bot logs the
  number in the item's own unit and shows a note.
- **One shop, one owner, one JSON file.** There is no multi-user or multi-shop support, and no
  backups beyond the file itself.
- **Voice notes are processed one at a time** to keep memory use low on 8 GB machines.
- **Speech accuracy depends on the recording.** Background noise and fast speech reduce it.
  Always check the "I heard" line before tapping Save.
- **Not tested on Windows or Linux.**
- The sample prices and currency (NGN) in `data/ledger.json` are placeholders.

## Security

- Keep `.env` private and never commit it (it is git-ignored). If a token leaks, send `/revoke`
  to @BotFather.
- `data/` (the sales log and the owner id) is also git-ignored.

## Ideas for later

WhatsApp support, several shops, price changes by voice, weekly reports, and a local language
model for phrasing the summaries.

## License

MIT, see [LICENSE](LICENSE).
