// Production smoke test: home page, one demo check in the browser, one live /api/check
// (no confirmation, so no Reppo eval), and phone-width screenshots.
// Run: BASE_URL=https://fairprice-ng.vercel.app npx tsx scripts/prod-smoke.ts
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const base = process.env.BASE_URL ?? "https://fairprice-ng.vercel.app";
mkdirSync("shots", { recursive: true });
mkdirSync("reports", { recursive: true });
const out: Record<string, unknown> = { base, ranAt: new Date().toISOString() };

const health = await fetch(`${base}/api/health`).then((r) => r.json());
out.health = health;

const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"] });
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
let t0 = Date.now();
await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle0" });
await page.waitForSelector("form select");
out.homeLoadMs = Date.now() - t0;
out.title = await page.title();
await page.screenshot({ path: "shots/12-prod-mobile-home.png" });

const selects = await page.$$("form select");
await selects[0].select("tomatoes");
await selects[1].select("NG-KANO");
const input = await page.$('input[inputmode="numeric"]');
await input!.click({ clickCount: 3 });
await input!.type("1400");
t0 = Date.now();
await page.click("form button[type=submit]");
await page.waitForSelector("article.verdict:not(.verdict-loading)", { timeout: 30_000 });
out.demoCheck = {
  ms: Date.now() - t0,
  stamp: await page.$eval("article.verdict", (el) => el.querySelector("[class*=stamp]")?.textContent?.trim() ?? el.textContent?.slice(0, 40)),
  reppoBadge: await page.$eval("article.verdict", (el) => el.querySelector(".reppo")?.textContent?.trim() ?? null),
};
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: "shots/13-prod-mobile-demo-verdict.png", fullPage: true });
out.consoleErrors = errors;
await browser.close();

t0 = Date.now();
const live = (await fetch(`${base}/api/check`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ itemId: "pms", areaId: "NG-KANO", quoteNaira: 1900, deviceId: `prod-smoke-${Date.now()}`, demo: false }),
}).then((r) => r.json())) as { verdict: Record<string, any> };
const v = live.verdict;
out.liveCheck = {
  ms: Date.now() - t0,
  id: v.id,
  label: v.label,
  band: [Math.round(v.low), Math.round(v.mid), Math.round(v.high)],
  quote: v.quoteNaira,
  servAvailable: v.servAvailable,
  servError: v.servError,
  reasons: v.reasons,
  tip: v.tip,
  note: v.note,
  reppo: v.reppo,
};
const stored = await fetch(`${base}/api/verdict/${v.id}`).then((r) => r.json());
out.liveStoredReadBack = Boolean((stored as any).verdict?.id === v.id);
writeFileSync("reports/prod-smoke.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
