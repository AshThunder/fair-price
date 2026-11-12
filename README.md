# Fair Price

A Nigeria-first price check for everyday stall goods, pump prices, fares, repairs, rent, and services. Type a quote or snap a price tag. The app returns a range, a verdict (fair, too high, suspiciously low, or not sure yet), short reasons, and a negotiation tip. Confirmed payments feed back into the price book, so later checks get measurably better.

Live at https://fairprice-ng.vercel.app and on Telegram as [@FairpriceSERV_bot](https://t.me/FairpriceSERV_bot).

Built for SERV Hackathon 02, Reppo track. SERV Reasoning judges the evidence pack. TypeScript code owns the range maths and hard rules. The live Reppo Eval Router scores each confirmed verdict, and `/metrics` shows seed-only versus after-feedback accuracy on a held-out benchmark next to those eval results.

## Local run

Keys live in a `chmod 600` `.env` (gitignored). Copy `.env.example` and fill in what you have.

```bash
cd fair-price
npm install
npm test
npm run dev
```

Then open http://127.0.0.1:5173. The Vite dev server proxies `/api` to the API on http://127.0.0.1:3001.

- Production-style serve after a build: `npm run build && npm start` (API and app on http://127.0.0.1:3001)
- Telegram long-poll (no public webhook needed): with the API running, `npm run dev:bot`, then message [@FairpriceSERV_bot](https://t.me/FairpriceSERV_bot)

Demo mode (header switch, or `?demo=1`) uses seeded data and saved Reppo evals. It never calls SERV or Reppo and never mixes with live data.

## Environment

| Variable | Purpose |
| --- | --- |
| `OPENSERV_API_KEY` | SERV Reasoning. Without it the code band is shown and the UI says the judgment service is off. |
| `REPPO_API_KEY` | Reppo Eval Router. Without it confirmations are still saved, just not scored. |
| `REPPO_DAILY_EVAL_CAP` | Rolling 24-hour cap on live evals (default 10, about 440 credits each). |
| `FAIRPRICE_TELEGRAM_BOT_TOKEN` | Telegram bot. |
| `TELEGRAM_WEBHOOK_SECRET` | If set, `/api/telegram` requires the matching `X-Telegram-Bot-Api-Secret-Token` header. |
| `DATABASE_URL` or `POSTGRES_URL` | Postgres connection string. Takes priority over PGlite. Pooler URLs work (prepared statements are off). |
| `PGLITE_DIR` | Local PGlite directory (default `data/.pglite`, gitignored). |
| `FAIRPRICE_STORE=memory` | Force an in-memory PGlite store (tests use this). |
| `SERV_TIMEOUT_MS` | SERV request timeout (default 30000). |

## Database

All runtime state lives in SQL: checks (`verdicts`), confirmed prices (`observations`), feedback, 24-hour device duplicate keys (`device_keys`), device trust counters (`devices`), Reppo eval records (`reppo_evals`), and Telegram chat sessions (`tg_sessions`).

- **Postgres** when `DATABASE_URL` or `POSTGRES_URL` is set (any hosted Postgres, for example Neon or Supabase). Nothing is provisioned by this repo.
- **PGlite** (embedded Postgres in WebAssembly) otherwise, stored in `data/.pglite`. On Vercel without a database URL it falls back to memory, and `/api/health` reports `durable: false`.
- **Migrations** are append-only entries in `server/db/migrations.ts`, applied on first connection and recorded in `schema_migrations`. Never edit an applied migration; add a new one.
- The duplicate check is a single atomic `INSERT … ON CONFLICT … WHERE` so two fast confirmations from one device cannot both count.
- `npm run db:inspect` prints row counts and the latest evals (stop the server first when using PGlite, which is single-process).

## What each piece does

- **Code** computes a weighted-median range from dated official anchors plus accepted confirmations, with zone then national fallback, a 15% fair band, outlier quarantine, a 24-hour same-device duplicate window, and device trust that grows with accepted confirmations and drops with quarantined ones.
- **SERV Reasoning** (`gpt-5.4-mini`, `inference-api.openserv.ai`) explains the verdict and writes the tip from a sanitized evidence pack. The computed range is authoritative: the label always follows where the quote sits in it, so the stamp, range bar, and text agree. If SERV's own verdict differs, its reasons and tip are dropped and any specific reason it gives is shown as "Ada's note". If SERV is down, the UI still shows the range and says so.
- **Reppo Eval Router** (`https://eval.reppo.xyz/api/v1/agents/evals`). When someone confirms what they paid on a live check, the evidence pack, the verdict, and the paid amount go to Reppo as one `claim` eval. Status is refreshed lazily when the check is read (at most every 4 seconds), so it works on serverless. The UI shows a "Checked by Reppo" badge; the eval ID sits behind its details and on `/metrics`.
- **Photo reader** runs in the browser with tesseract.js after a greyscale and contrast pass. Photos are never uploaded. The reader prefers amounts with a naira mark, skips pack sizes such as 75cl, and always asks you to check the number.
- **Abuse limits**: 30 checks and 20 confirmations per 10 minutes per IP and device, per instance.

## Benchmark

`data/benchmark.json` has 73 Nigerian price cases across food, transport, fuel, repairs, rent, and services, each tied to a cited source (NBS price watches, press reports, published repair and rent guides). A case is labelled fair when the quote is within 15% of the cited reference. Cases are split by a hash of their ID into dev (27) and a held-out test split (46); engine settings were not tuned on the test split. Rebuild with `npm run bench`.

"After feedback" replays a simulated confirmation stream (seeded, with scatter, a small upward bias, 30% wild outliers, and 30% duplicates) through the same anti-gaming gate the app uses.

| Split | Seed only | After feedback |
| --- | --- | --- |
| Test (46) | 47.8% (22/46) | 82.6% (38/46) |
| Dev (27) | 51.9% (14/27) | 85.2% (23/27) |
| All (73) | 49.3% (36/73) | 83.6% (61/73) |

Honest limits: the simulated confirmations are drawn around the same references used for the labels, so the after-feedback number shows the loop works, not real-world accuracy. Repairs, rent, and services start with no official anchor and so score near zero seed-only. The benchmark measures the code engine; SERV's wording is not scored here. Reppo scores live verdicts separately.

## Checks you can run

- `npm test`: engine, API, database, benchmark, SERV client, OCR parser, and Telegram handler tests (in-memory store, no keys)
- `npm run e2e:live`: one live check through SERV, one paid confirmation to Reppo (spends one eval), polls it, and writes `reports/e2e-live.json`
- `npm run e2e:telegram`: `getMe` on the bot token, then synthetic updates through the webhook route with a captured sender (nobody is messaged)
- `npm run ocr:check`: runs the in-browser photo reader in headless Chrome on the tag photos in `tests/fixtures`
- `npm run shots`: refreshes `shots/` in demo mode

## Seed data

`data/seed.json` holds a small, attributed transcription of published National Bureau of Statistics averages (Selected Food Price Watch, PMS Price Watch, Transport Fare Watch, LPG Price Watch). Official terms at https://www.nigerianstat.gov.ng/page/terms do not allow redistributing the raw workbooks; those files are not in this repository. Figures are monthly averages, not live stall or pump prices, and are labelled that way in the product.

## Deploy notes

Production runs on Vercel (project `fair-price`, functions in `iad1`) with a free Neon Postgres database from the Vercel Marketplace, which sets `DATABASE_URL` and `POSTGRES_URL`. Vite builds the app to `dist/public`; `api/index.ts` serves `/api/*`; `vercel.json` has the SPA fallback. Migrations run on the first database connection; `npm run db:migrate` applies them by hand.

The Telegram bot uses a webhook at `/api/telegram` with `TELEGRAM_WEBHOOK_SECRET`. While the webhook is set, `npm run dev:bot` (long-poll) will not receive updates; delete the webhook first if you need local polling.

`npm run smoke:prod` loads the home page, runs a demo check in headless Chrome, runs one live check without confirming (no Reppo spend), and saves phone-width screenshots.

Do not commit `.env`. Do not put NBS raw files in the repo.
