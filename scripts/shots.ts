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

async function fill(page: Page, selector: string, value: string) {
  const el = await page.$(selector);
  if (!el) throw new Error(`missing ${selector}`);
  await el.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (value) await el.type(value);
}

async function check(page: Page, country: string, item: string, place: string, price: string) {
  await page.goto(`${base}/?demo=1&country=${country}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("form.check-form");
  const [itemInput, placeInput] = await page.$$("form.check-form input[list]");
  await itemInput.click({ clickCount: 3 });
  await itemInput.type(item);
  await placeInput.click({ clickCount: 3 });
  if (place) await placeInput.type(place);
  await fill(page, "form.check-form .money-input input", price);
  await page.click("form button[type=submit]");
  await page.waitForSelector("article.verdict:not(.verdict-loading)", { timeout: 30_000 });
}

async function viewport(width: number, height: number, mobile: boolean): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  return page;
}

const only = process.env.SHOTS ?? "all";

if (only === "all" || only === "phone") {
  const page = await newPage(390);
  await page.goto(`${base}/?demo=1&country=NG`, { waitUntil: "networkidle0" });
  await page.waitForSelector("form.check-form");
  await shot(page, "01-home");
  await check(page, "NG", "Rice (local), 1 kg", "", "1905");
  await shot(page, "02-verdict-fair", "article.verdict");
  await check(page, "NG", "Petrol (PMS)", "Kano", "2400");
  await shot(page, "03-verdict-high", "article.verdict");
  await check(page, "KE", "Petrol", "Nairobi", "150");
  await shot(page, "04-verdict-low-kenya", "article.verdict");
  await check(page, "JP", "Umbrella repair", "Osaka", "1500");
  await shot(page, "05-verdict-uncertain-japan", "article.verdict");
  await page.goto(`${base}/board?demo=1&country=GB`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".board-list");
  await shot(page, "06-board-uk");
  await page.goto(`${base}/how?demo=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".how-cards");
  await shot(page, "07-how");
  await page.goto(`${base}/metrics?demo=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".headline-metric");
  await shot(page, "07b-metrics");

  const narrow = await newPage(360);
  await narrow.goto(`${base}/?demo=1&country=NG`, { waitUntil: "networkidle0" });
  await narrow.waitForSelector("form.check-form");
  await shot(narrow, "08-mobile-360-home");
  await check(narrow, "US", "Eggs, a dozen", "", "4.50");
  await shot(narrow, "09-mobile-360-verdict");
}

if (only === "all" || only === "desktop") {
  const wide = await viewport(1440, 1000, false);
  await wide.goto(`${base}/?demo=1&country=NG`, { waitUntil: "networkidle0" });
  await wide.waitForSelector("form.check-form");
  await shot(wide, "10-desktop-1440-home");
  await check(wide, "GB", "Petrol", "Belfast", "1.79");
  await shot(wide, "10b-desktop-1440-verdict");
  await wide.goto(`${base}/board?demo=1&country=NG`, { waitUntil: "networkidle0" });
  await wide.waitForSelector(".board-list");
  await shot(wide, "11-desktop-1440-board");
  await wide.goto(`${base}/metrics?demo=1`, { waitUntil: "networkidle0" });
  await wide.waitForSelector(".headline-metric");
  await shot(wide, "11b-desktop-1440-metrics");
  const mid = await viewport(1280, 900, false);
  await check(mid, "IN", "Petrol", "Mumbai", "111");
  await shot(mid, "11c-desktop-1280-verdict");
}

await browser.close();
