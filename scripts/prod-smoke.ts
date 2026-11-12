// Production smoke test: home page, one demo check in the browser, one live /api/check
// (no confirmation, so no Reppo eval), and 360 px phone plus 1440 px desktop screenshots.
// Run: BASE_URL=https://fairprice-global.vercel.app npx tsx scripts/prod-smoke.ts
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const base = process.env.BASE_URL ?? "https://fairprice-global.vercel.app";
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
async function fillCheck(country: string, item: string, place: string, price: string) {
  await page.goto(`${base}/?demo=1&country=${country}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("form.check-form");
  const [itemInput, placeInput] = await page.$$("form.check-form input[list]");
  await itemInput.click({ clickCount: 3 });
  await itemInput.type(item);
  await placeInput.click({ clickCount: 3 });
  if (place) await placeInput.type(place);
  const price$ = await page.$("form.check-form .money-input input");
  await price$!.click({ clickCount: 3 });
  await price$!.type(price);
  const t = Date.now();
  await page.click("form button[type=submit]");
  await page.waitForSelector("article.verdict:not(.verdict-loading)", { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 700));
  return {
    ms: Date.now() - t,
    stamp: await page.$eval("article.verdict", (el) => el.querySelector("[class*=stamp]")?.textContent?.trim() ?? null),
    title: await page.$eval("article.verdict", (el) => el.querySelector(".verdict-title")?.textContent?.trim() ?? null),
    reppoBadge: await page.$eval("article.verdict", (el) => el.querySelector(".reppo")?.textContent?.trim() ?? null),
  };
}

// Phone, 360 px
await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
let t0 = Date.now();
await page.goto(`${base}/?demo=1&country=NG`, { waitUntil: "networkidle0" });
await page.waitForSelector("form.check-form");
out.homeLoadMs = Date.now() - t0;
out.title = await page.title();
await page.screenshot({ path: "shots/12-prod-360-home.png", fullPage: true });
out.demoCheckPhone = await fillCheck("NG", "Fresh tomatoes", "Kano", "1400");
await page.screenshot({ path: "shots/13-prod-360-verdict.png", fullPage: true });

// Desktop, 1440 px
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await page.goto(`${base}/?demo=1&country=NG`, { waitUntil: "networkidle0" });
await page.waitForSelector("form.check-form");
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "shots/14-prod-1440-home.png", fullPage: true });
out.demoCheckDesktop = await fillCheck("GB", "Petrol", "Belfast", "1.79");
await page.screenshot({ path: "shots/15-prod-1440-verdict.png", fullPage: true });
await page.goto(`${base}/board?demo=1&country=KE`, { waitUntil: "networkidle0" });
await page.waitForSelector(".board-list");
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: "shots/16-prod-1440-board-kenya.png", fullPage: true });
out.consoleErrors = errors;
await browser.close();

// One live check (SERV only; no confirmation, so no Reppo eval).
t0 = Date.now();
const live = (await fetch(`${base}/api/check`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ country: "KE", place: "Nairobi", itemText: "petrol", quote: 260, deviceId: `prod-smoke-${Date.now()}`, demo: false }),
}).then((r) => r.json())) as { verdict: Record<string, any> };
const v = live.verdict;
out.liveCheck = {
  ms: Date.now() - t0,
  id: v.id,
  label: v.label,
  band: [v.low, v.mid, v.high],
  quote: v.quote,
  currency: v.currency,
  area: `${v.areaName}, ${v.countryName}`,
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
