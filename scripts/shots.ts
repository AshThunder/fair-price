// Refresh product screenshots from a running server (npm run build && npm start).
// Uses demo mode so no SERV or Reppo credits are spent.
import { mkdirSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const dir = new URL("../shots/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});

async function newPage(width: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  return page;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string, selector?: string) {
  await wait(500);
  if (selector) {
    const el = await page.$(selector);
    if (!el) throw new Error(`missing ${selector}`);
    await el.screenshot({ path: `${dir}${name}.png` });
  } else {
    await page.screenshot({ path: `${dir}${name}.png`, fullPage: true });
  }
  process.stdout.write(`wrote shots/${name}.png\n`);
}

async function check(page: Page, itemId: string, areaId: string, price: string) {
  await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector("form select");
  const selects = await page.$$("form select");
  await selects[0].select(itemId);
  await selects[1].select(areaId);
  const input = await page.$("form input[inputmode=numeric]");
  await input!.click({ clickCount: 3 });
  await input!.type(price);
  await page.click("form button[type=submit]");
  await page.waitForSelector("article.verdict:not(.verdict-loading)", { timeout: 20_000 });
}

const page = await newPage(390);
await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle0" });
await page.waitForSelector("form select");
await shot(page, "01-home");

await check(page, "rice-local", "NG", "1905.43");
await shot(page, "02-verdict-fair", "article.verdict");
await page.click("details.reppo summary");
await shot(page, "02b-verdict-fair-full");

await check(page, "pms", "NG-KANO", "2400");
await shot(page, "03-verdict-high", "article.verdict");

await check(page, "rice-local", "NG-ENUGU", "900");
await shot(page, "04-verdict-low", "article.verdict");

await check(page, "barbing", "NG-ABUJA", "2500");
await shot(page, "05-verdict-uncertain", "article.verdict");

await page.goto(`${base}/board?demo=1`, { waitUntil: "networkidle0" });
await page.waitForSelector(".board-list");
await shot(page, "06-board");

await page.goto(`${base}/metrics?demo=1`, { waitUntil: "networkidle0" });
await page.waitForSelector(".headline-metric");
await shot(page, "07-metrics");

const narrow = await newPage(360);
await narrow.goto(`${base}/?demo=1`, { waitUntil: "networkidle0" });
await narrow.waitForSelector("form select");
await shot(narrow, "08-mobile-360-home");
await check(narrow, "tomatoes", "NG-KANO", "1400");
await shot(narrow, "09-mobile-360-verdict");

const wide = await browser.newPage();
await wide.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await wide.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await check(wide, "tomatoes", "NG-KANO", "1400");
await shot(wide, "10-desktop-verdict");
await wide.goto(`${base}/metrics?demo=1`, { waitUntil: "networkidle0" });
await wide.waitForSelector(".headline-metric");
await shot(wide, "11-desktop-metrics");

await browser.close();
