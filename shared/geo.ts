// Countries, currencies, units, and free-text resolution. Works in Node and the browser.
import type { Area, Item } from "./types.js";

/** ISO 3166-1 alpha-2 -> ISO 4217. Covers the countries people are most likely to pick. */
export const CURRENCY_BY_COUNTRY: Record<string, string> = {
  AE: "AED", AF: "AFN", AL: "ALL", AM: "AMD", AO: "AOA", AR: "ARS", AT: "EUR", AU: "AUD", AZ: "AZN",
  BA: "BAM", BB: "BBD", BD: "BDT", BE: "EUR", BF: "XOF", BG: "BGN", BH: "BHD", BI: "BIF", BJ: "XOF",
  BO: "BOB", BR: "BRL", BS: "BSD", BT: "BTN", BW: "BWP", BY: "BYN", BZ: "BZD", CA: "CAD", CD: "CDF",
  CF: "XAF", CG: "XAF", CH: "CHF", CI: "XOF", CL: "CLP", CM: "XAF", CN: "CNY", CO: "COP", CR: "CRC",
  CU: "CUP", CV: "CVE", CY: "EUR", CZ: "CZK", DE: "EUR", DJ: "DJF", DK: "DKK", DO: "DOP", DZ: "DZD",
  EC: "USD", EE: "EUR", EG: "EGP", ER: "ERN", ES: "EUR", ET: "ETB", FI: "EUR", FJ: "FJD", FR: "EUR",
  GA: "XAF", GB: "GBP", GE: "GEL", GH: "GHS", GM: "GMD", GN: "GNF", GQ: "XAF", GR: "EUR", GT: "GTQ",
  GW: "XOF", GY: "GYD", HK: "HKD", HN: "HNL", HR: "EUR", HT: "HTG", HU: "HUF", ID: "IDR", IE: "EUR",
  IL: "ILS", IN: "INR", IQ: "IQD", IR: "IRR", IS: "ISK", IT: "EUR", JM: "JMD", JO: "JOD", JP: "JPY",
  KE: "KES", KG: "KGS", KH: "KHR", KM: "KMF", KR: "KRW", KW: "KWD", KZ: "KZT", LA: "LAK", LB: "LBP",
  LK: "LKR", LR: "LRD", LS: "LSL", LT: "EUR", LU: "EUR", LV: "EUR", LY: "LYD", MA: "MAD", MD: "MDL",
  ME: "EUR", MG: "MGA", MK: "MKD", ML: "XOF", MM: "MMK", MN: "MNT", MO: "MOP", MR: "MRU", MT: "EUR",
  MU: "MUR", MV: "MVR", MW: "MWK", MX: "MXN", MY: "MYR", MZ: "MZN", NA: "NAD", NE: "XOF", NG: "NGN",
  NI: "NIO", NL: "EUR", NO: "NOK", NP: "NPR", NZ: "NZD", OM: "OMR", PA: "PAB", PE: "PEN", PG: "PGK",
  PH: "PHP", PK: "PKR", PL: "PLN", PR: "USD", PT: "EUR", PY: "PYG", QA: "QAR", RO: "RON", RS: "RSD",
  RU: "RUB", RW: "RWF", SA: "SAR", SB: "SBD", SC: "SCR", SD: "SDG", SE: "SEK", SG: "SGD", SI: "EUR",
  SK: "EUR", SL: "SLE", SN: "XOF", SO: "SOS", SR: "SRD", SS: "SSP", SV: "USD", SY: "SYP", SZ: "SZL",
  TD: "XAF", TG: "XOF", TH: "THB", TJ: "TJS", TL: "USD", TM: "TMT", TN: "TND", TR: "TRY", TT: "TTD",
  TW: "TWD", TZ: "TZS", UA: "UAH", UG: "UGX", US: "USD", UY: "UYU", UZ: "UZS", VE: "VES", VN: "VND",
  YE: "YER", ZA: "ZAR", ZM: "ZMW", ZW: "ZWG",
};

const LANGUAGE_BY_COUNTRY: Record<string, string> = {
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt", FR: "fr", BE: "fr", CI: "fr", SN: "fr", CM: "fr", DE: "de", AT: "de",
  CH: "de", ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", IT: "it", NL: "nl", JP: "ja", CN: "zh",
  KR: "ko", RU: "ru", TR: "tr", ID: "id", VN: "vi", TH: "th", PL: "pl", SE: "sv", EG: "ar", SA: "ar", AE: "ar",
};

/** Countries where shoppers price by the pound and the US gallon. */
const IMPERIAL = new Set(["US", "LR", "MM", "PR"]);

export function isCountry(code: string | undefined | null): code is string {
  return Boolean(code && CURRENCY_BY_COUNTRY[code.toUpperCase()]);
}

export function localeFor(country: string): string {
  const cc = country.toUpperCase();
  return `${LANGUAGE_BY_COUNTRY[cc] ?? "en"}-${cc}`;
}

export function unitSystem(country: string): "metric" | "imperial" {
  return IMPERIAL.has(country.toUpperCase()) ? "imperial" : "metric";
}

export function countryName(code: string, displayLocale = "en"): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Format money with the currency's own symbol and digits, e.g. ₦1,400, $4.48, £1.68, R$ 6,51. */
export function money(amount: number, currency: string, locale?: string): string {
  if (!Number.isFinite(amount)) return "n/a";
  const digits = Math.abs(amount) >= 1000 ? 0 : amountDigits(currency, amount);
  try {
    return new Intl.NumberFormat(locale ?? "en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(digits)}`;
  }
}

function amountDigits(currency: string, amount: number): number {
  // Naira, shillings, rupees and similar are quoted in whole units for everyday prices.
  if (["NGN", "KES", "UGX", "TZS", "INR", "PKR", "BDT", "LKR", "NPR", "JPY", "KRW", "IDR", "VND", "CLP", "COP", "HUF", "ISK", "PYG", "XOF", "XAF", "RWF"].includes(currency)) return 0;
  return amount >= 100 ? 0 : 2;
}

export function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function titleCase(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Units offered for a free-text item, in the order a shopper in that country would expect. */
export function unitOptions(country: string): string[] {
  const rest = ["dozen", "trip", "hour", "month", "service"];
  return unitSystem(country) === "imperial"
    ? ["each", "1 lb", "1 US gallon", "1 kg", "1 litre", ...rest]
    : ["each", "1 kg", "1 litre", "1 lb", ...rest];
}

export function itemUnit(item: Item, country: string): string {
  return item.units?.[country.toUpperCase()] ?? item.unit;
}

export function itemName(item: Item, country: string): string {
  return item.names?.[country.toUpperCase()] ?? item.name;
}

/** A country-level area for any ISO country, seeded or not. */
export function countryArea(areas: Area[], country: string): Area | undefined {
  const cc = country.toUpperCase();
  const seeded = areas.find((a) => a.kind === "country" && a.country === cc);
  if (seeded) return seeded;
  if (!isCountry(cc)) return undefined;
  return { id: cc, name: countryName(cc), kind: "country", country: cc, currency: CURRENCY_BY_COUNTRY[cc], parentId: null, custom: true };
}

/** Rebuild a free-text area from its id (CC:city:slug) so stored rows stay readable. */
export function areaFromId(areas: Area[], id: string): Area | undefined {
  const seeded = areas.find((a) => a.id === id);
  if (seeded) return seeded;
  const m = /^([A-Z]{2}):city:([a-z0-9-]+)$/.exec(id);
  if (m) {
    const parent = countryArea(areas, m[1]);
    if (!parent) return undefined;
    return { id, name: titleCase(m[2].replace(/-/g, " ")), kind: "city", country: parent.country, currency: parent.currency, parentId: parent.id, custom: true };
  }
  if (/^[A-Z]{2}$/.test(id)) return countryArea(areas, id);
  return undefined;
}

/**
 * Resolve a place: a seeded area id, or a country plus free-text city. Unknown cities become
 * a custom city under the country, so confirmations there build their own range.
 */
export function resolveArea(areas: Area[], input: { areaId?: string; country?: string; place?: string }): Area | undefined {
  if (input.areaId) {
    const a = areaFromId(areas, input.areaId);
    if (a) return a;
  }
  const country = (input.country ?? "").toUpperCase();
  const top = countryArea(areas, country);
  if (!top) return undefined;
  const place = (input.place ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!place) return top;
  const key = slug(place);
  const seeded = areas.find(
    (a) => a.country === top.country && (slug(a.name) === key || (a.aliases ?? []).some((x) => slug(x) === key)),
  );
  if (seeded) return seeded;
  if (!key) return top;
  return { id: `${top.country}:city:${key}`, name: titleCase(place), kind: "city", country: top.country, currency: top.currency, parentId: top.id, custom: true };
}

/** Resolve an item: a catalog id, a catalog name or alias, or a new free-text item with its unit. */
export function resolveItem(items: Item[], input: { itemId?: string; text?: string; unit?: string; country?: string }): Item | undefined {
  if (input.itemId) {
    const found = items.find((i) => i.id === input.itemId);
    if (found) return found;
    const m = /^x-([a-z0-9-]+)--([a-z0-9-]+)$/.exec(input.itemId);
    if (m) return customItem(m[1].replace(/-/g, " "), m[2].replace(/-/g, " "));
  }
  const text = (input.text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) return undefined;
  const key = slug(text);
  const cc = (input.country ?? "").toUpperCase();
  const match = items.find(
    (i) =>
      slug(i.name) === key ||
      (cc && i.names?.[cc] && slug(i.names[cc]) === key) ||
      (i.aliases ?? []).some((a) => slug(a) === key),
  );
  if (match) return match;
  const unit = (input.unit ?? "").trim().slice(0, 24) || "each";
  return customItem(text, unit);
}

function customItem(name: string, unit: string): Item {
  const n = name.replace(/\s+/g, " ").trim();
  return { id: `x-${slug(n)}--${slug(unit)}`, name: n.charAt(0).toUpperCase() + n.slice(1), unit, category: "other", custom: true };
}

/** Walk from an area up to its country: [self, parent..., country]. Never leaves the country. */
export function areaChain(areas: Area[], area: Area): Area[] {
  const chain: Area[] = [area];
  let cur: Area | undefined = area;
  for (let i = 0; i < 6 && cur?.parentId; i++) {
    const next = areaFromId(areas, cur.parentId);
    if (!next || next.country !== area.country) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB", "united kingdom": "GB", britain: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB",
  usa: "US", "united states": "US", america: "US", "united states of america": "US", us: "US",
  brasil: "BR", naija: "NG", "south africa": "ZA", uae: "AE", "ivory coast": "CI", "cote d'ivoire": "CI",
};

/** Find a country from a code (NG), a name (Nigeria), or a common alias (UK, USA). */
export function findCountry(text: string): string | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return undefined;
  if (/^[a-z]{2}$/.test(t) && isCountry(t.toUpperCase())) return t.toUpperCase();
  if (COUNTRY_ALIASES[t]) return COUNTRY_ALIASES[t];
  for (const code of Object.keys(CURRENCY_BY_COUNTRY)) {
    if (countryName(code).toLowerCase() === t) return code;
  }
  return undefined;
}

/** Guess a country from a browser or Telegram locale such as "en-GB" or "pt-BR". */
export function countryFromLocale(locale: string | undefined | null): string | undefined {
  const m = /[-_]([A-Za-z]{2})\b/.exec(locale ?? "");
  const cc = m?.[1]?.toUpperCase();
  return cc && isCountry(cc) ? cc : undefined;
}

/** "per 1 kg", but never "per per drop". */
export function perUnit(unit: string): string {
  return /^per\b/i.test(unit.trim()) ? unit.trim() : `per ${unit.trim()}`;
}
