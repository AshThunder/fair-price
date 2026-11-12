import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const base = "http://127.0.0.1:3001";
const dir = "/workspace/fair-price/shots";
mkdirSync(dir, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  async function shot(name: string) {
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, type: "png" });
    process.stdout.write(`wrote shots/${name}.png\n`);
  }

  await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.waitForSelector("form");
  await shot("01-home");

  async function check(itemLabel: string, areaLabel: string, price: string, name: string) {
    await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle0" });
    await page.waitForSelector("form");
    const itemSelect = await page.$("select");
    const areaSelect = (await page.$$("select"))[1];
    const itemValue = await page.$$eval("select option", (opts, label) => {
      const hit = opts.find((o) => (o.textContent ?? "").includes(label as string));
      return hit?.value ?? "";
    }, itemLabel);
    const areaValue = await page.$$eval("select option", (opts, label) => {
      const hits = opts.filter((o) => (o.textContent ?? "").trim() === label);
      return hits.at(-1)?.value ?? "";
    }, areaLabel);
    await itemSelect?.select(itemValue);
    await areaSelect?.select(areaValue);
    const input = await page.$('input[inputMode="decimal"], input');
    await input?.click({ clickCount: 3 });
    await page.keyboard.type(price);
    await page.click('button[type="submit"]');
    await page.waitForSelector(".verdict", { timeout: 20_000 });
    await shot(name);
  }

  await check("Local short-grained rice", "Nigeria (national)", "1905", "02-verdict-fair");
  await check("Local short-grained rice", "Nigeria (national)", "3200", "03-verdict-high");
  await check("Local short-grained rice", "Nigeria (national)", "900", "04-verdict-low");
  await check("Phone screen", "Enugu", "25000", "05-verdict-uncertain");
  await check("Fresh tomatoes", "Kano", "1400", "08-verdict-tomatoes");

  await page.goto(`${base}/board?demo=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".board-row");
  await shot("06-board");

  await page.goto(`${base}/metrics?demo=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".metrics-pair");
  await shot("07-metrics");

  await browser.close();
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
