import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { api, money, type Catalog, type PublicVerdict } from "../api";
import { countryOf, currencySymbol, itemLabel, itemUnitFor } from "../catalog";
import { getDeviceId } from "../device";
import { readPriceFromPhoto } from "../ocr";
import { slug } from "../../shared/geo";

export interface Preset {
  country: string;
  itemId: string;
  place: string;
  quote: number;
  nonce: number;
}

export function CheckForm({
  catalog,
  country,
  onCountry,
  demo,
  preset,
  onResult,
  onBusy,
  onError,
}: {
  catalog: Catalog;
  country: string;
  onCountry: (code: string) => void;
  demo: boolean;
  preset: Preset | null;
  onResult: (v: PublicVerdict) => void;
  onBusy: (b: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const ids = useId();
  const info = countryOf(catalog, country);
  const [itemText, setItemText] = useState("");
  const [unit, setUnit] = useState(info.unitOptions[0] ?? "1 item");
  const [place, setPlace] = useState("");
  const [quote, setQuote] = useState("");
  const [source, setSource] = useState<"typed" | "photo-confirmed">("typed");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: "item" | "quote"; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Items and places with data in this country come first in the suggestions.
  const suggestions = useMemo(() => {
    const local = catalog.items.filter((i) => i.countries?.includes(country) || (country === "NG" && !i.countries?.length));
    return local.map((i) => ({ id: i.id, label: itemLabel(i, country), unit: itemUnitFor(i, country) }));
  }, [catalog, country]);
  const places = useMemo(() => {
    // Cities and states first, broad regions (such as Nigeria's zones) last.
    const inCountry = catalog.areas.filter((a) => a.country === country && a.kind !== "country");
    const broad = (a: (typeof inCountry)[number]) => a.kind === "region" && a.parentId === country && inCountry.some((b) => b.parentId === a.id);
    return [...inCountry.filter((a) => !broad(a)), ...inCountry.filter(broad)].map((a) => a.name);
  }, [catalog, country]);
  // Same matching as the server: a catalog name, this country's name, or an alias.
  const matched = useMemo(() => {
    const key = slug(itemText);
    if (!key) return undefined;
    const item = catalog.items.find(
      (i) => slug(i.name) === key || (i.names?.[country] && slug(i.names[country]) === key) || (i.aliases ?? []).some((a) => slug(a) === key),
    );
    return item ? { id: item.id, label: itemLabel(item, country), unit: itemUnitFor(item, country) } : undefined;
  }, [catalog, country, itemText]);
  const symbol = currencySymbol(info.currency, info.locale);

  useEffect(() => {
    setUnit(info.unitOptions[0] ?? "1 item");
  }, [info.code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!preset) return;
    const item = catalog.items.find((i) => i.id === preset.itemId);
    if (item) setItemText(itemLabel(item, preset.country));
    setPlace(preset.place);
    setQuote(String(preset.quote));
    setSource("typed");
    void run({ country: preset.country, itemId: preset.itemId, place: preset.place, quote: preset.quote, source: "typed" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce]);

  async function onPhoto(file: File) {
    setFieldError(null);
    setSource("photo-confirmed");
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
    setReading(true);
    setOcrNote("Reading the price from your photo");
    try {
      const hint = await readPriceFromPhoto(file, info.currency);
      if (hint.amount) {
        setQuote(String(hint.amount));
        const other = hint.currencyGuess !== "unknown" && hint.currencyGuess !== info.currency;
        setOcrNote(
          other
            ? `Read ${hint.amount} with a ${hint.currencyGuess} mark, but prices here are in ${info.currency}. Check the number and the country.`
            : `Read ${money(hint.amount, info.currency, info.locale)} from the photo. Check the number before you continue.`,
        );
      } else {
        setOcrNote("No price could be read from that photo. Type the amount you can see.");
      }
    } catch {
      setOcrNote("The photo reader could not run on this device. Type the amount you can see.");
    } finally {
      setReading(false);
    }
  }

  async function run(input: { country: string; itemId?: string; itemText?: string; unit?: string; place: string; quote: number; source: "typed" | "photo-confirmed" }) {
    setSubmitting(true);
    onBusy(true);
    onError(null);
    try {
      const { verdict } = await api.check({ ...input, place: input.place.trim() || undefined, deviceId: getDeviceId(), demo });
      onResult(verdict);
    } catch (err) {
      onError(err instanceof Error ? err.message : "The check could not be completed.");
    } finally {
      setSubmitting(false);
      onBusy(false);
    }
  }

  function parseAmount(text: string): number {
    // Accept 1,900 / 1.900 / 6,49 / 4.49: a separator followed by exactly 3 digits is thousands.
    const t = text.replace(/[^\d.,]/g, "");
    const normal = t.replace(/[.,](?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    return Number(normal);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (itemText.trim().length < 2) {
      setFieldError({ field: "item", text: "Type what you are buying, for example eggs or a taxi ride" });
      return;
    }
    const amount = parseAmount(quote);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFieldError({ field: "quote", text: `Type the price you were quoted, in ${info.currency}` });
      return;
    }
    setFieldError(null);
    void run(
      matched
        ? { country, itemId: matched.id, place, quote: amount, source }
        : { country, itemText: itemText.trim(), unit, place, quote: amount, source },
    );
  }

  const seeded = catalog.countries.filter((c) => c.seeded);
  const rest = catalog.countries.filter((c) => !c.seeded);

  return (
    <form className="card form-grid check-form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor={`${ids}-country`}>Country</label>
        <select id={`${ids}-country`} value={country} onChange={(e) => onCountry(e.target.value)}>
          <optgroup label="With starter prices">
            {seeded.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.currency})
              </option>
            ))}
          </optgroup>
          <optgroup label="Everywhere else">
            {rest.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.currency})
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${ids}-item`}>What are you buying</label>
        <input
          id={`${ids}-item`}
          className={`text-input${fieldError?.field === "item" ? " invalid" : ""}`}
          list={`${ids}-items`}
          value={itemText}
          autoComplete="off"
          maxLength={60}
          placeholder="Eggs, petrol, a haircut, anything"
          aria-invalid={fieldError?.field === "item"}
          onChange={(e) => setItemText(e.target.value)}
        />
        <datalist id={`${ids}-items`}>
          {suggestions.map((s) => (
            <option key={s.id} value={s.label} />
          ))}
        </datalist>
        {fieldError?.field === "item" ? (
          <p className="field-error" role="alert">
            {fieldError.text}
          </p>
        ) : null}
      </div>

      <div className="field-pair">
        <div className="field">
          <label htmlFor={`${ids}-place`}>Where</label>
          <input
            id={`${ids}-place`}
            className="text-input"
            list={`${ids}-places`}
            value={place}
            autoComplete="off"
            maxLength={60}
            placeholder={places[0] ? `e.g. ${places[0]}` : "Town or city"}
            onChange={(e) => setPlace(e.target.value)}
          />
          <datalist id={`${ids}-places`}>
            {places.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-unit`}>Per</label>
          {matched ? (
            <p className="unit-fixed" id={`${ids}-unit`}>
              {matched.unit}
            </p>
          ) : (
            <select id={`${ids}-unit`} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {info.unitOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${ids}-quote`}>Price you were quoted</label>
        <div className={`money-input${fieldError?.field === "quote" ? " invalid" : ""}`}>
          <span aria-hidden="true">{symbol}</span>
          <input
            id={`${ids}-quote`}
            inputMode="decimal"
            autoComplete="off"
            value={quote}
            aria-invalid={fieldError?.field === "quote"}
            aria-describedby={`${ids}-cur${fieldError?.field === "quote" ? ` ${ids}-err` : ""}`}
            onChange={(e) => setQuote(e.target.value)}
            placeholder={info.currency === "NGN" ? "1900" : "4.50"}
          />
        </div>
        <p className="field-hint" id={`${ids}-cur`}>
          In {info.currency}. Fair Price never converts currencies
        </p>
        {fieldError?.field === "quote" ? (
          <p className="field-error" id={`${ids}-err`} role="alert">
            {fieldError.text}
          </p>
        ) : null}
      </div>

      <div className="photo-row">
        <label className="btn btn-ghost file-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          Read a price tag
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPhoto(file);
            }}
          />
        </label>
        {photoUrl ? <img className="photo-thumb" src={photoUrl} alt="Your price photo" /> : null}
      </div>
      {ocrNote ? (
        <p className="field-hint ocr-note" role="status">
          {reading ? <span className="dot-spinner" aria-hidden="true" /> : null}
          {ocrNote}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || reading}>
        {submitting ? "Ada is checking" : "Check this price"}
      </button>
    </form>
  );
}
