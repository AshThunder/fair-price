import { useEffect, useState } from "react";
import { api, type Catalog, type CatalogItem, type CountryOption } from "./api";

let cached: Promise<Catalog> | null = null;

export function loadCatalog(force = false): Promise<Catalog> {
  if (!cached || force) {
    cached = api.catalog();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    loadCatalog(nonce > 0)
      .then((c) => live && setCatalog(c))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [nonce]);
  return { catalog, error, retry: () => setNonce((n) => n + 1) };
}

export function countryOf(catalog: Catalog | null, code: string): CountryOption {
  return (
    catalog?.countries.find((c) => c.code === code) ?? {
      code,
      name: code,
      currency: "USD",
      locale: "en-US",
      units: "metric",
      seeded: false,
      unitOptions: ["1 item", "1 kg", "1 litre"],
    }
  );
}

export const itemLabel = (item: CatalogItem, country: string) => item.names?.[country] ?? item.name;
export const itemUnitFor = (item: CatalogItem, country: string) => item.units?.[country] ?? item.unit;

/** Currency symbol as people write it, for an input prefix. */
export function currencySymbol(currency: string, locale: string): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}
