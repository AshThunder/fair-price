// Runs the PWA's photo reader in a real headless Chrome against sample price-tag photos.
// Needs a running server (npm run build && npm start). Nothing is sent to SERV or Reppo.
// Run: npx tsx scripts/ocr-check.ts
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const cases = [
  { file: "tests/fixtures/tag-rice-handwritten.jpg", expected: 1900 },
  { file: "tests/fixtures/tag-palmoil-printed.jpg", expected: 2450 },
  { file: "tests/fixtures/tag-tomatoes-synthetic.png", expected: 1400 },
];

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [];
for (const c of cases) {
  const page = await browser.newPage();
  await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle0" });
  const input = await page.waitForSelector('input[type="file"]');
  const t0 = Date.now();
  await input!.uploadFile(resolve(c.file));
  await page.waitForFunction(
    () => {
      const n = document.querySelector(".ocr-note")?.textContent ?? "";
      return n && !n.startsWith("Reading");
    },
    { timeout: 120_000 },
  );
  const quote = await page.$eval('input[inputmode="numeric"]', (el) => (el as HTMLInputElement).value);
  const read = quote ? Number(quote) : null;
  const row = { file: c.file, expected: c.expected, read, ok: read === c.expected, ms: Date.now() - t0 };
  results.push(row);
  console.log(JSON.stringify(row));
  await page.close();
}
await browser.close();
console.log(`${results.filter((r) => r.ok).length}/${results.length} read correctly`);
