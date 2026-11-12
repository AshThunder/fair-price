# Fair Price

A Nigeria-first price check for everyday stall goods, pump prices, fares, repairs, and rent. Type a quote or snap a ticket. The app returns a range, a verdict (fair, high, low, or uncertain), reasons, and a negotiation tip. Confirmed payments feed back into the stall book so later checks can get measurably better.

Built for SERV Hackathon 02, Reppo track. SERV Reasoning judges the evidence pack. TypeScript code owns the range maths and hard rules. The live Reppo Eval Router is load-bearing: verdict quality is scored, and the public `/metrics` page shows seed-only versus after-feedback accuracy on a fixed benchmark plus those eval results.

## Local run

Keys live in a `chmod 600` `.env` (gitignored). Copy `.env.example` and fill in `OPENSERV_API_KEY`, `REPPO_API_KEY`, and `FAIRPRICE_TELEGRAM_BOT_TOKEN` if you have them.

```bash
cd fair-price
npm install
npm test
npm run dev
```

Then open http://127.0.0.1:5173. The Vite dev server proxies `/api` to the API on http://127.0.0.1:3001.

- Production-style local serve after a build: `npm run build && npm start` (API + static app on http://127.0.0.1:3001)
- Telegram long-poll (no public webhook needed): with the API running, `npm run dev:bot`, then message [@FairpriceSERV_bot](https://t.me/FairpriceSERV_bot)

Demo mode (header toggle, or `?demo=1`) uses seeded data and pre-completed Reppo evals and does not spend live credits.

## What each piece does

- **Code** computes a weighted-median range from dated official anchors plus accepted confirmations, with zone then national fallback, a 15% fair band, outlier quarantine, and same-device duplicate rejection.
- **SERV Reasoning** (`gpt-5.4-mini`, `inference-api.openserv.ai`) writes the judgment, reasons, and tip from a sanitized evidence pack. If SERV is down, the UI still shows the code band and says so.
- **Reppo Eval Router** (`https://eval.reppo.xyz/api/v1/agents/evals`) scores those packs. Demo mode displays saved evals. Live checks may queue an eval in the background.
- **Photo reader** runs in the browser with tesseract.js. Photos are never sent to SERV or Reppo. You confirm the number.
- **Anti-gaming**: 24-hour same-device duplicates are ignored; wild outliers are quarantined; new devices start with lower trust.

## Seed data

`data/seed.json` holds a small, attributed transcription of published May 2026 National Bureau of Statistics averages (Selected Food Price Watch, PMS Price Watch, Transport Fare Watch). Official terms at https://www.nigerianstat.gov.ng/page/terms do not allow redistributing the raw workbooks; those files are not in this repository. Figures are monthly averages, not live stall or pump prices, and are labelled that way in the product.

Phone repairs and room rent have no official seed and usually return uncertain until enough confirms exist.

## Deploy notes

Vercel-ready: Vite static build to `dist/public`, serverless `api/index.ts` for `/api/*`. Runtime confirmations persist to `data/runtime.json` when the filesystem is writable, otherwise `/tmp` or memory (Vercel is ephemeral — a durable store is needed before a public launch). Setting a Telegram webhook needs a public HTTPS URL and explicit approval.

Do not commit `.env`. Do not put NBS raw files in the repo.
