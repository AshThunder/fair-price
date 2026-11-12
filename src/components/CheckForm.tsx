import { useEffect, useId, useState, type FormEvent } from "react";
import { api, CATEGORY_LABEL, type Catalog, type PublicVerdict } from "../api";
import { getDeviceId } from "../device";
import { readPriceFromPhoto } from "../ocr";

export interface Preset {
  itemId: string;
  areaId: string;
  quote: number;
  nonce: number;
}

const AREA_GROUPS: Array<{ kind: string; label: string }> = [
  { kind: "state", label: "States" },
  { kind: "zone", label: "Zones" },
  { kind: "national", label: "Whole country" },
];

export function CheckForm({
  demo,
  preset,
  onResult,
  onBusy,
  onError,
}: {
  demo: boolean;
  preset: Preset | null;
  onResult: (v: PublicVerdict) => void;
  onBusy: (b: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const ids = useId();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [itemId, setItemId] = useState("rice-local");
  const [areaId, setAreaId] = useState("NG-KANO");
  const [quote, setQuote] = useState("");
  const [source, setSource] = useState<"typed" | "photo-confirmed">("typed");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function loadCatalog() {
    setCatalogError(null);
    api.catalog().then(setCatalog).catch((err: Error) => setCatalogError(err.message));
  }
  useEffect(loadCatalog, []);

  useEffect(() => {
    if (!preset) return;
    setItemId(preset.itemId);
    setAreaId(preset.areaId);
    setQuote(String(preset.quote));
    setSource("typed");
    void run(preset.itemId, preset.areaId, preset.quote, "typed");
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
      const hint = await readPriceFromPhoto(file);
      if (hint.amount) {
        setQuote(String(Math.round(hint.amount)));
        setOcrNote(`Read ₦${Math.round(hint.amount).toLocaleString("en-NG")} from the photo. Check the number before you continue.`);
      } else {
        setOcrNote("No price could be read from that photo. Type the amount you can see.");
      }
    } catch {
      setOcrNote("The photo reader could not run on this device. Type the amount you can see.");
    } finally {
      setReading(false);
    }
  }

  async function run(item: string, area: string, amount: number, src: "typed" | "photo-confirmed") {
    setSubmitting(true);
    onBusy(true);
    onError(null);
    try {
      const { verdict } = await api.check({ itemId: item, areaId: area, quoteNaira: amount, deviceId: getDeviceId(), demo, source: src });
      onResult(verdict);
    } catch (err) {
      onError(err instanceof Error ? err.message : "The check could not be completed.");
    } finally {
      setSubmitting(false);
      onBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const amount = Number(quote.replace(/[,\s₦]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setFieldError("Type the price you were quoted, in naira, for example 1900");
      return;
    }
    setFieldError(null);
    void run(itemId, areaId, amount, source);
  }

  if (catalogError) {
    return (
      <div className="card state-card" role="alert">
        <p className="state-title">The price list did not load</p>
        <p className="muted">{catalogError}</p>
        <button type="button" className="btn btn-ghost" onClick={loadCatalog}>Try again</button>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="card form-grid" aria-busy="true" aria-label="Loading the price list">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-field">
            <span className="skeleton skeleton-label" />
            <span className="skeleton skeleton-input" />
          </div>
        ))}
        <span className="skeleton skeleton-button" />
      </div>
    );
  }

  const categories = [...new Set(catalog.items.map((i) => i.category))];
  const unit = catalog.items.find((i) => i.id === itemId)?.unit;

  return (
    <form className="card form-grid" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor={`${ids}-item`}>What are you buying</label>
        <select id={`${ids}-item`} value={itemId} onChange={(e) => setItemId(e.target.value)}>
          {categories.map((cat) => (
            <optgroup key={cat} label={CATEGORY_LABEL[cat] ?? cat}>
              {catalog.items
                .filter((i) => i.category === cat)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-area`}>Where</label>
        <select id={`${ids}-area`} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {AREA_GROUPS.map((g) => (
            <optgroup key={g.kind} label={g.label}>
              {catalog.areas
                .filter((a) => a.kind === g.kind)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${ids}-quote`}>Price you were quoted</label>
        <div className={`money-input${fieldError ? " invalid" : ""}`}>
          <span aria-hidden="true">₦</span>
          <input
            id={`${ids}-quote`}
            inputMode="numeric"
            autoComplete="off"
            value={quote}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={`${ids}-unit${fieldError ? ` ${ids}-err` : ""}`}
            onChange={(e) => setQuote(e.target.value)}
            placeholder="1900"
          />
        </div>
        <p className="field-hint" id={`${ids}-unit`}>Per {unit}</p>
        {fieldError ? (
          <p className="field-error" id={`${ids}-err`} role="alert">
            {fieldError}
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
