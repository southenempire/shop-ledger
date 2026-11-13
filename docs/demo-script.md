# Demo script (about 90 seconds)

Before recording: `npm run ledger -- init --force` (an empty shop), start `npm run bot`, open the bot on
your phone. Screen-record the phone and the terminal side by side if you can.

**0:00 Problem (10 s)**
"Many small shop owners keep no sales records, because spreadsheets and apps feel like extra work.
Shop Ledger lets them talk instead."

**0:10 Set up the shop (15 s)**
"Every shop sells different things, so it starts empty." Send:
`/additem Rice, bag, 20, 5, 45000` and `/additem Indomie, carton, 15, 4, 6500, noodles`.

**0:25 Voice note (20 s)**
Send: "I sold three bags of rice and two cartons of Indomie."
Show the reply: `I heard: "..."` and the preview with the stock change. Point at the terminal:
"The transcription ran on this laptop with QVAC. No cloud speech service."

**0:35 Confirm (10 s)**
Tap **Save**. "Nothing is written until the owner confirms, so a misheard word never corrupts the records."

**0:45 Low-stock alert (15 s)**
Send: "I sold fifteen bags of rice." Tap Save. Show the low-stock warning.

**1:00 Summary (15 s)**
Send `/summary`. Show sales, revenue and the low-stock list. Mention the automatic daily summary at 20:00.

**1:15 Honest limits and close (15 s)**
"Inference is local; Telegram still needs the internet. Pidgin support is partial. Next: WhatsApp
and more local-language support." Show the repo link.

Backup if the network fails: run `npm run ledger -- voice <file>` in the terminal to show the same
on-device pipeline without Telegram.
