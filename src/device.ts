const KEY = "fair-price-device";
const DEMO = "fair-price-demo";

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getDemoFlag(): boolean {
  const q = new URLSearchParams(location.search).get("demo");
  if (q === "1" || q === "true") return true;
  if (q === "0" || q === "false") return false;
  return localStorage.getItem(DEMO) === "true";
}

export function setDemoFlag(value: boolean): void {
  localStorage.setItem(DEMO, String(value));
}

const COUNTRY = "fair-price-country";

// A time zone says more about where someone is than a browser language does
// (many phones in Nigeria or Kenya report en-US or en-GB).
const ZONE_COUNTRY: Record<string, string> = {
  "Africa/Lagos": "NG",
  "Africa/Nairobi": "KE",
  "Africa/Accra": "GH",
  "Africa/Johannesburg": "ZA",
  "Africa/Cairo": "EG",
  "Africa/Kampala": "UG",
  "Africa/Dar_es_Salaam": "TZ",
  "Africa/Addis_Ababa": "ET",
  "Africa/Casablanca": "MA",
  "Africa/Abidjan": "CI",
  "Africa/Dakar": "SN",
  "Africa/Kigali": "RW",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Manila": "PH",
  "Asia/Jakarta": "ID",
  "Asia/Tokyo": "JP",
  "Asia/Singapore": "SG",
  "Asia/Dubai": "AE",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL",
  "America/Sao_Paulo": "BR",
  "America/Manaus": "BR",
  "America/Fortaleza": "BR",
  "America/Recife": "BR",
  "America/Bahia": "BR",
  "America/Belem": "BR",
  "America/Mexico_City": "MX",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Bogota": "CO",
  "America/Lima": "PE",
  "America/Argentina/Buenos_Aires": "AR",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
};

export function detectCountry(known: (code: string) => boolean): string {
  const q = new URLSearchParams(location.search).get("country")?.toUpperCase();
  if (q && known(q)) return q;
  const saved = localStorage.getItem(COUNTRY);
  if (saved && known(saved)) return saved;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (ZONE_COUNTRY[zone] && known(ZONE_COUNTRY[zone])) return ZONE_COUNTRY[zone];
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Indiana)/.test(zone)) return "US";
  } catch {
    // fall through to the language
  }
  for (const lang of navigator.languages ?? [navigator.language]) {
    const m = /[-_]([A-Za-z]{2})\b/.exec(lang ?? "");
    if (m && known(m[1].toUpperCase())) return m[1].toUpperCase();
  }
  return "US";
}

export function saveCountry(code: string): void {
  localStorage.setItem(COUNTRY, code);
}
