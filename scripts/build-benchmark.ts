// Builds data/benchmark.json from a declarative list of reference prices and
// quote multipliers. Labels come from a fixed rule against the reference price,
// never from the engine, so the engine cannot "agree with itself".
//
// Run: npx tsx scripts/build-benchmark.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkCase, BenchmarkFile, BenchmarkSource, SeedFile, VerdictLabel } from "../shared/types.js";
import { deviceHash } from "../shared/engine.js";
import { areaChain, areaFromId, money, slug } from "../shared/geo.js";

const ROOT = join(import.meta.dirname, "..");
const seed = JSON.parse(readFileSync(join(ROOT, "data/seed.json"), "utf8")) as SeedFile;

const sources: BenchmarkSource[] = [
  {
    id: "nbs-food-2026-05",
    title: "NBS Selected Food Price Watch, May 2026",
    url: "https://microdata.nigerianstat.gov.ng/index.php/catalog/162",
    published: "2026-06",
    kind: "official",
    note: "Zonal and national averages already cited in data/seed.json. Used as the reference for food control cases.",
  },
  {
    id: "nbs-fare-2026-05",
    title: "NBS Transport Fare Watch, May 2026",
    url: "https://microdata.nigerianstat.gov.ng/index.php/catalog/161",
    published: "2026-06",
    kind: "official",
    note: "State averages already cited in data/seed.json. Used as the reference for fare control cases.",
  },
  {
    id: "pms-nov-2026-abuja",
    title: "Legit.ng: NNPC, MRS and other stations reduce petrol prices (Abuja ₦1,325 to ₦1,420 per litre)",
    url: "https://www.legit.ng/business-economy/energy/1740285-relief-nnpc-filling-stations-reduce-petrol-prices/",
    published: "2026-11",
    kind: "press",
    note: "Station checks in Abuja in early November 2026. Reference set to ₦1,380, the middle of the reported band.",
  },
  {
    id: "pms-nov-2026-national",
    title: "Finelib: Petrol price in Nigeria, November 2026 (₦1,325 to ₦1,429 per litre)",
    url: "https://www.finelib.com/knowledge/prices/products/Finelib-Prices-Petrol-PMS-Nigeria-Reference-v1.html",
    published: "2026-11",
    kind: "press",
    note: "Aggregates six dated November 2026 reports. Reference set to ₦1,375.",
  },
  {
    id: "pms-nov-2026-kano",
    title: "Punch via ST Office fuel tracker: petrol about ₦1,420 per litre in Kano (11 Nov 2026)",
    url: "https://seyitinubu.com/fuel-price",
    published: "2026-11-11",
    kind: "press",
    note: "Single dated report. Reference set to ₦1,420.",
  },
  {
    id: "lpg-oct-2026",
    title: "LPG in Nigeria: 12.5 kg cylinder averages ₦18,593.75 in October 2026",
    url: "https://www.lpginnigeria.com/details/nigerias-cooking-gas-prices-rise-by-555-in-october-as-125kg-cylinder-averages-n1859375",
    published: "2026-11",
    kind: "press",
    note: "National average with a reported spread of ₦16,250 to ₦21,250. Applied to states inside that spread; the April NBS anchor in the seed is older and higher.",
  },
  {
    id: "water-kano",
    title: "Daily Trust: price of sachet water surges to ₦350 per bag in Kano",
    url: "https://dailytrust.com/price-of-sachet-water-surges-to-n350-per-bag-in-kano/",
    published: "2026",
    kind: "press",
    note: "₦300 to ₦350 per bag. Reference ₦325.",
  },
  {
    id: "water-ibadan",
    title: "The AWB News: sachet water prices in Ibadan (about ₦400 per bag)",
    url: "https://theawbnews.com/sachet-water-prices-ibadan-nigeria/",
    published: "2026",
    kind: "press",
    note: "Retailers and buyers report about ₦400 per bag (Ibadan bags hold 16 sachets). Reference ₦400.",
  },
  {
    id: "water-abuja",
    title: "NAN: unstable power threatens sachet water sellers (Abuja trader sells at ₦600)",
    url: "https://nannews.ng/unstable-power-threatens-sachet-water-ice-sellers-businesses/",
    published: "2026",
    kind: "press",
    note: "One trader's price, so a thin reference. Reference ₦600.",
  },
  {
    id: "barber-2026",
    title: "TrustAm barber price guide 2026 (city ranges for a basic cut)",
    url: "https://www.trustamai.com/tools/barber-haircut-price-calculator",
    published: "2026",
    kind: "listing-aggregate",
    note: "Abuja ₦875 to ₦2,000, Port Harcourt ₦770 to ₦1,760, other cities ₦560 to ₦1,440. References at roughly the middle: ₦1,400, ₦1,250 and ₦1,000.",
  },
  {
    id: "screen-2026",
    title: "Carlcare screen price lists and TechView Africa repair cost survey (budget Android screens)",
    url: "https://techviewafrica.com/articles/we-checked-what-it-costs-to-repair-20-popular-smartphones-in-nigeria-screens-are-the-expensive-part",
    published: "2026",
    kind: "listing-aggregate",
    note: "Budget TECNO and Infinix displays about ₦19,000 to ₦21,300 before fitting; general shop screen jobs from ₦25,000. Reference ₦20,000 for a typical budget-Android screen job, applied nationally.",
  },
  {
    id: "rent-ibadan",
    title: "TrustAm: living on ₦100,000 in Ibadan in 2026 (room rent ₦15,000 to ₦21,000 a month)",
    url: "https://www.trustamai.com/blog/how-to-survive-on-naira100000-in-ibadan-in-2026",
    published: "2026",
    kind: "listing-aggregate",
    note: "Single room at the lower end of the quoted band. Reference ₦15,000 a month.",
  },
  {
    id: "rent-enugu",
    title: "Mushrooms: single rooms for rent in Enugu (₦100,000 to ₦180,000 a year typical)",
    url: "https://mushrooms.ng/rent/enugu/single-rooms-for-rent",
    published: "2026",
    kind: "listing-aggregate",
    note: "Typical band converted to ₦8,300 to ₦15,000 a month. Reference ₦11,500.",
  },
  {
    id: "rent-port-harcourt",
    title: "Mushrooms: student housing near UNIPORT and RSU (single room ₦100,000 to ₦250,000 a year)",
    url: "https://mushrooms.ng/blog/student-housing-uniport-port-harcourt-guide",
    published: "2026",
    kind: "listing-aggregate",
    note: "Converted to about ₦8,300 to ₦20,800 a month. Reference ₦14,500.",
  },
  {
    id: "aa-petrol-nov-2026",
    title: "AA: petrol averaging 172.0p a litre (November 2026)",
    url: "https://www.theaa.com/about-us/newsroom/petrol-prices-fall-middle-east-conflict",
    published: "2026-11",
    kind: "press",
    note: "Independent pump survey; the seed anchor is RAC Fuel Watch at 168.45p.",
  },
  {
    id: "findpetrol-nov-2026",
    title: "findpetrol.co.uk UK Fuel Price Index, November 2026 (provisional)",
    url: "https://www.findpetrol.co.uk/uk-fuel-price-index/monthly/2026-11.pdf",
    published: "2026-11-11",
    kind: "listing-aggregate",
    note: "Regional petrol averages (Greater Belfast 162.7p, Highlands and Islands 174.3p), also in the seed.",
  },
  {
    id: "ons-shopping-2026-09",
    title: "ONS shopping prices comparison tool, September 2026 (via UK in Data)",
    url: "https://www.uk-data.app/chart/shopping-prices/",
    published: "2026-10",
    kind: "official",
    note: "UK average shop prices; the seed holds the same figures.",
  },
  {
    id: "bls-ap-2026-09",
    title: "US BLS Average Price Data, September 2026 (ALFRED release of 14 Oct 2026)",
    url: "https://alfred.stlouisfed.org/release?rd=2026-10-14&rid=454",
    published: "2026-10-14",
    kind: "official",
    note: "U.S. city averages; the seed holds the same figures.",
  },
  {
    id: "epra-2026-10",
    title: "EPRA maximum retail pump prices, 15 Oct to 14 Nov 2026",
    url: "https://www.epra.go.ke/pump-prices",
    published: "2026-10-14",
    kind: "official",
    note: "Town-level regulated maximums. Thika, Machakos, Embu and Wajir are not in the seed.",
  },
  {
    id: "knbs-cpi-2026-10",
    title: "KNBS CPI October 2026 average retail prices (via The Kenya Times)",
    url: "https://thekenyatimes.com/economy/headache-for-kenyans-as-prices-of-essential-commodities-hike/",
    published: "2026-10-30",
    kind: "press-report-of-official",
    note: "National averages; the seed holds the same figures.",
  },
  {
    id: "hdfc-fuel-2026-11-12",
    title: "HDFC Sky: petrol and diesel prices, 12 November 2026",
    url: "https://hdfcsky.com/news/petrol-diesel-prices-today-november-12-2026-check-latest-rates-in-delhi-mumbai-chennai-kolkata-bengaluru-and-other-cities",
    published: "2026-11-12",
    kind: "press",
    note: "City retail prices. Lucknow, Chandigarh and Gurgaon are not in the seed.",
  },
  {
    id: "lpg-in-2026-11",
    title: "SmartFigure: 14.2 kg domestic LPG, November 2026",
    url: "https://smartfigure.in/lpg-price/delhi/new-delhi/",
    published: "2026-11-12",
    kind: "listing-aggregate",
    note: "Metro refill prices; the seed holds the same figures.",
  },
  {
    id: "anp-weekly-43-2026",
    title: "ANP Síntese semanal 43/2026 (18 to 24 Oct 2026)",
    url: "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/arq-sintese-semanal/2026/sintese-precos-43.pdf",
    published: "2026-10",
    kind: "official",
    note: "National weekly average R$ 6,49 and capital-city averages.",
  },
  {
    id: "anp-glp-2026-10",
    title: "ANP weekly survey, GLP P-13, 11 to 17 Oct 2026 (via Baratão)",
    url: "https://usebaratao.com.br/blog/preco-dos-combustiveis-em-outubro-diesel-sobe-e-etanol-cai/",
    published: "2026-10",
    kind: "press-report-of-official",
    note: "National average R$ 114,73 per 13 kg cylinder; the seed holds the same figure.",
  },
];

function anchorFor(itemId: string, areaId: string): { price: number; areaName: string } {
  const area = areaFromId(seed.areas, areaId)!;
  for (const a of areaChain(seed.areas, area)) {
    const ref = seed.officialRefs.find((r) => r.itemId === itemId && r.areaId === a.id);
    if (ref) return { price: ref.price, areaName: a.name };
  }
  throw new Error(`No anchor for ${itemId} ${areaId}`);
}

type Truth = { itemId: string; areaId: string; truthAmount: number; source: string; reasoning: string; quotes: number[]; kind: "control" | "cross-source"; currency: string };
const currencyOf = (areaId: string) => areaFromId(seed.areas, areaId)!.currency;

const truths: Truth[] = [];
function control(itemId: string, areaId: string, source: string, quotes: number[]) {
  const a = anchorFor(itemId, areaId);
  truths.push({
    itemId,
    areaId,
    truthAmount: a.price,
    source,
    reasoning: `Control case. Reference is the published figure for ${a.areaName}; the seed holds the same anchor, so this tests the band and fallback maths rather than freshness.`,
    quotes,
    kind: "control",
    currency: currencyOf(areaId),
  });
}
function fresh(itemId: string, areaId: string, truthAmount: number, source: string, reasoning: string, quotes: number[]) {
  truths.push({ itemId, areaId, truthAmount, source, reasoning, quotes, kind: "cross-source", currency: currencyOf(areaId) });
}

// Food controls (multipliers on the reference)
control("rice-local", "NG", "nbs-food-2026-05", [1.0, 1.45]);
control("rice-local", "NG-KANO", "nbs-food-2026-05", [1.38]);
control("rice-local", "NG-ENUGU", "nbs-food-2026-05", [0.64]);
control("rice-imported", "NG-ABUJA", "nbs-food-2026-05", [0.99, 0.7]);
control("beans-brown", "NG-BAUCHI", "nbs-food-2026-05", [1.03]);
control("beans-brown", "NG-OYO", "nbs-food-2026-05", [1.34]);
control("garri-white", "NG-RIVERS", "nbs-food-2026-05", [1.0]);
control("garri-white", "NG-KADUNA", "nbs-food-2026-05", [0.69]);
control("tomatoes", "NG-ENUGU", "nbs-food-2026-05", [1.41]);
control("tomatoes", "NG-OYO", "nbs-food-2026-05", [0.97]);
control("yam", "NG-ABUJA", "nbs-food-2026-05", [0.99]);
control("yam", "NG-KANO", "nbs-food-2026-05", [1.43]);
control("palm-oil", "NG-RIVERS", "nbs-food-2026-05", [0.63]);
control("palm-oil", "NG-OYO", "nbs-food-2026-05", [0.97]);

// Fare controls
control("bus-city", "NG-KANO", "nbs-fare-2026-05", [0.94, 1.41]);
control("bus-city", "NG-ENUGU", "nbs-fare-2026-05", [1.02, 0.72]);
control("okada", "NG-KADUNA", "nbs-fare-2026-05", [0.99, 0.7]);
control("okada", "NG-RIVERS", "nbs-fare-2026-05", [1.54]);
control("okada", "NG-BAUCHI", "nbs-fare-2026-05", [0.96]);
control("bus-intercity", "NG-ABUJA", "nbs-fare-2026-05", [1.0, 1.36]);
control("bus-intercity", "NG-OYO", "nbs-fare-2026-05", [0.71]);
control("bus-intercity", "NG-KANO", "nbs-fare-2026-05", [1.01]);

// Fresher prices: the seed anchor is months old (stale-anchor cases)
const pmsWhy = "Pump prices fell after the May 2026 NBS reading; a November 2026 report is the reference, so the seed anchor is about 14 to 16 percent high.";
fresh("pms", "NG-ABUJA", 1380, "pms-nov-2026-abuja", pmsWhy, [1.01, 0.94, 1.23]);
fresh("pms", "NG-KANO", 1420, "pms-nov-2026-kano", pmsWhy, [1.0, 0.92, 1.3]);
fresh("pms", "NG", 1375, "pms-nov-2026-national", pmsWhy, [0.98, 0.8, 1.2]);
const lpgWhy = "Cooking gas eased from the April 2026 NBS reading of about ₦22,400 to an October 2026 national average near ₦18,600; the October figure is the reference.";
fresh("lpg-12kg", "NG", 18594, "lpg-oct-2026", lpgWhy, [1.0, 1.29, 0.7]);
fresh("lpg-12kg", "NG-KANO", 18594, "lpg-oct-2026", lpgWhy, [1.05]);
fresh("lpg-12kg", "NG-ABUJA", 18594, "lpg-oct-2026", lpgWhy, [1.08]);
fresh("lpg-12kg", "NG-ENUGU", 18594, "lpg-oct-2026", lpgWhy, [0.91]);
fresh("lpg-12kg", "NG-RIVERS", 18594, "lpg-oct-2026", lpgWhy, [1.4]);
fresh("lpg-12kg", "NG-OYO", 18594, "lpg-oct-2026", lpgWhy, [0.67]);

// No official anchor at all: only confirmations can help
const noAnchor = "No NBS series covers this, so the seed alone can only say uncertain.";
fresh("pure-water", "NG-KANO", 325, "water-kano", noAnchor, [0.92, 1.54]);
fresh("pure-water", "NG-OYO", 400, "water-ibadan", noAnchor, [1.0, 1.5, 0.62]);
fresh("pure-water", "NG-ABUJA", 600, "water-abuja", noAnchor, [1.0, 0.67]);
fresh("phone-screen", "NG-ABUJA", 20000, "screen-2026", noAnchor, [1.0, 1.1]);
fresh("phone-screen", "NG-KANO", 20000, "screen-2026", noAnchor, [1.75]);
fresh("phone-screen", "NG-ENUGU", 20000, "screen-2026", noAnchor, [0.6]);
fresh("phone-screen", "NG-RIVERS", 20000, "screen-2026", noAnchor, [0.9]);
fresh("phone-screen", "NG-OYO", 20000, "screen-2026", noAnchor, [1.4]);
fresh("room-rent", "NG-OYO", 15000, "rent-ibadan", noAnchor, [1.0, 1.67]);
fresh("room-rent", "NG-ENUGU", 11500, "rent-enugu", noAnchor, [1.04, 0.61, 1.74]);
fresh("room-rent", "NG-RIVERS", 14500, "rent-port-harcourt", noAnchor, [1.03, 0.62]);
fresh("barbing", "NG-ABUJA", 1400, "barber-2026", noAnchor, [1.07, 1.79]);
fresh("barbing", "NG-RIVERS", 1250, "barber-2026", noAnchor, [0.96, 0.64]);
fresh("barbing", "NG-KANO", 1000, "barber-2026", noAnchor, [1.0, 1.5]);
fresh("barbing", "NG-OYO", 1000, "barber-2026", noAnchor, [0.6, 1.1]);

// Beyond Nigeria. Cross-source cases use a different publication (or a town with no seed
// figure) from the anchor the engine sees; control cases reuse the seed anchor.
const ukWhy = "AA's own pump survey for the same week reads about 3.5p above the RAC figure in the seed.";
fresh("pms", "GB", 1.72, "aa-petrol-nov-2026", ukWhy, [1.0, 1.25, 0.78]);
control("pms", "GB-BELFAST", "findpetrol-nov-2026", [1.0, 1.2]);
control("pms", "GB-HIGHLANDS", "findpetrol-nov-2026", [0.8]);
control("bread-white", "GB", "ons-shopping-2026-09", [1.0, 1.5]);
control("eggs-dozen", "GB", "ons-shopping-2026-09", [0.7, 1.05]);
control("tomatoes", "GB", "ons-shopping-2026-09", [1.4]);
control("pms", "US", "bls-ap-2026-09", [1.0, 1.3, 0.75]);
control("eggs-dozen", "US", "bls-ap-2026-09", [1.0, 1.6]);
control("bread-white", "US", "bls-ap-2026-09", [0.98]);
control("milk", "US", "bls-ap-2026-09", [1.25]);
const keWhy = "EPRA sets a separate regulated maximum for this town; the seed has no figure for it, so the engine falls back to the KNBS national average.";
fresh("pms", "KE:city:thika", 226.63, "epra-2026-10", keWhy, [1.0, 1.3]);
fresh("pms", "KE:city:machakos", 227.01, "epra-2026-10", keWhy, [0.8]);
fresh("pms", "KE:city:embu", 228.4, "epra-2026-10", keWhy, [1.02]);
fresh("pms", "KE:city:wajir", 241.54, "epra-2026-10", "Remote towns carry higher regulated maximums; Wajir is about 6 percent above the national average.", [1.0, 1.2]);
control("sugar", "KE", "knbs-cpi-2026-10", [1.0, 0.6]);
control("lpg-12kg", "KE", "knbs-cpi-2026-10", [1.3]);
const inWhy = "India has no national pump average in the seed and no figure for this city, so only confirmations can produce a range.";
fresh("pms", "IN:city:lucknow", 101.89, "hdfc-fuel-2026-11-12", inWhy, [1.0, 1.25, 0.75]);
fresh("pms", "IN:city:chandigarh", 101.54, "hdfc-fuel-2026-11-12", inWhy, [1.05]);
fresh("pms", "IN:city:gurgaon", 102.97, "hdfc-fuel-2026-11-12", inWhy, [0.8]);
control("pms", "IN-MUMBAI", "hdfc-fuel-2026-11-12", [1.0, 1.2]);
control("lpg-12kg", "IN-DELHI", "lpg-in-2026-11", [1.0, 1.4]);
fresh("pms", "BR", 6.49, "anp-weekly-43-2026", "ANP's weekly survey for 18 to 24 October reads R$ 6,49, against the monthly October average of R$ 6,51 in the seed.", [1.0, 1.25, 0.8]);
control("pms", "BR-MANAUS", "anp-weekly-43-2026", [1.0]);
control("pms", "BR-VITORIA", "anp-weekly-43-2026", [1.3]);
control("lpg-12kg", "BR", "anp-glp-2026-10", [1.0, 0.7]);

function roundQuote(n: number, currency: string): number {
  if (currency !== "NGN") return Number(n.toPrecision(3));
  if (n < 2000) return Math.round(n / 50) * 50;
  if (n < 20000) return Math.round(n / 100) * 100;
  return Math.round(n / 500) * 500;
}

export const FAIR_TOLERANCE = 0.15;
function label(quote: number, truth: number): VerdictLabel {
  const r = quote / truth;
  if (r > 1 + FAIR_TOLERANCE) return "high";
  if (r < 1 - FAIR_TOLERANCE) return "low";
  return "fair";
}

const cases: BenchmarkCase[] = [];
for (const t of truths) {
  const item = seed.items.find((i) => i.id === t.itemId)!;
  const area = areaFromId(seed.areas, t.areaId)!;
  for (const m of t.quotes) {
    const quote = roundQuote(t.truthAmount * m, t.currency);
    const expected = label(quote, t.truthAmount);
    const areaKey =
      area.country === "NG" ? t.areaId.replace("NG-", "").replace(/^NG$/, "national").toLowerCase() : `${area.country.toLowerCase()}-${slug(area.name)}`;
    const id = `bm-${t.itemId}-${areaKey}-${quote}`;
    const split = parseInt(deviceHash(id), 16) % 10 < 3 ? "dev" : "test";
    cases.push({
      id,
      itemId: t.itemId,
      areaId: t.areaId,
      quote: quote,
      currency: t.currency,
      country: area.country,
      kind: t.kind,
      expected,
      trueAmount: t.truthAmount,
      category: item.category,
      split,
      truthSource: t.source,
      note: `${item.names?.[area.country] ?? item.name} in ${area.name}: quote ${money(quote, t.currency)} vs reference ${money(t.truthAmount, t.currency)} (${Math.round((quote / t.truthAmount - 1) * 100)}%), so ${expected}. ${t.reasoning}`,
    });
  }
}

const file: BenchmarkFile = {
  version: "2026-11-12.2",
  asOf: "2026-11-12",
  labelRule: `A quote is fair within ${FAIR_TOLERANCE * 100}% of the reference price, high above that, low below it. Labels come from this rule and the reference price only, never from the engine.`,
  method: [
    "Each case pairs an item and area with a reference price from a public, citable source (national statistics already cited in the seed, such as NBS, BLS, ONS or KNBS, regulator price lists such as EPRA or ANP, or a dated press or listing report), then sets quotes at fixed multiples of that reference and rounds them the way traders quote.",
    "NBS raw workbooks are not copied. Official references are single headline figures already transcribed and cited in data/seed.json, or quoted in NBS press summaries.",
    "Cases are reported per country. Control cases reuse the same figure the seed holds, so they only test band maths and fallback. Cross-source cases use a different publication or a town with no seed figure. In Nigeria, stale-anchor cases (petrol, cooking gas) and no-anchor cases (sachet water, phone screens, rent, haircuts) are where feedback can matter.",
    "Cases are split by a hash of the case id: about 30% dev, 70% held-out test. Engine parameters (15% band, trust weights, outlier rules) were frozen before the benchmark was built and were not tuned on either split.",
    "After-feedback runs feed a simulated stream of paid confirmations through the real anti-gaming gate. The stream is generated from the reference price with noise, plus duplicate and outlier attempts; it never sees the quotes or labels. See shared/benchmark.ts.",
    "Reference prices from press and listing aggregates are estimates, not audited field surveys. Treat the numbers as a reproducible sanity check, not a market study.",
  ],
  sources,
  truths: truths.map(({ quotes: _q, ...t }) => t),
  cases,
};

writeFileSync(join(ROOT, "data/benchmark.json"), JSON.stringify(file, null, 2) + "\n");
const by = (k: (c: BenchmarkCase) => string) =>
  cases.reduce<Record<string, number>>((acc, c) => ((acc[k(c)] = (acc[k(c)] ?? 0) + 1), acc), {});
console.log(`cases ${cases.length}`, by((c) => c.split!), by((c) => c.expected), by((c) => c.category!), by((c) => c.country!), by((c) => c.kind!));
