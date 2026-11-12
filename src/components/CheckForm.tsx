import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { api, type Catalog, type PublicVerdict } from "../api";
import { getDeviceId } from "../device";
import { parsePriceFromText } from "../../shared/ocr";

export function CheckForm({
  demo,
  onResult,
  onBusy,
}: {
  demo: boolean;
  onResult: (v: PublicVerdict) => void;
  onBusy: (b: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [itemId, setItemId] = useState("rice-local");
  const [areaId, setAreaId] = useState("NG-KANO");
  const [quote, setQuote] = useState("");
  const [source, setSource] = useState<"typed" | "photo-confirmed">("typed");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api.catalog().then((c) => {
      setCatalog(c);
    }).catch((err: Error) => setError(err.message));
  }, []);

  async function onPhoto(file: File) {
    setError(null);
    setOcrNote("Reading the price from your photo. You will still confirm the number.");
    setSource("photo-confirmed");
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
    setReading(true);
    try {
      const Tesseract = (await import("tesseract.js")).default;
      const result = await Tesseract.recognize(file, "eng", { logger: () => undefined });
      const hint = parsePriceFromText(result.data.text ?? "");
      if (hint.amount) {
        setQuote(String(Math.round(hint.amount)));
        setOcrNote(`Read ${Math.round(hint.amount)} from the photo. Confirm or correct the number before checking.`);
      } else {
        setOcrNote("No price could be read. Type the amount you can see.");
      }
    } catch {
      setOcrNote("The photo reader could not run in this browser. Type the amount you can see.");
    } finally {
      setReading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const amount = Number(quote);
    if (!itemId || !areaId || !Number.isFinite(amount) || amount <= 0) {
      setError("Choose an item, an area, and a price greater than zero.");
      return;
    }
    setError(null);
    setSubmitting(true);
    onBusy(true);
    try {
      const { verdict } = await api.check({
        itemId,
        areaId,
        quoteNaira: amount,
        deviceId: getDeviceId(),
        demo,
        source,
      });
      onResult(verdict);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The check could not be completed.");
    } finally {
      setSubmitting(false);
      onBusy(false);
    }
  }

  const items = catalog?.items ?? [];
  const areas = catalog?.areas ?? [];

  return (
    <form className="card form-grid" onSubmit={onSubmit}>
      <label>
        <span>Item</span>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Area</span>
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)} required>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Quoted price, naira</span>
        <input
          inputMode="decimal"
          value={quote}
          onChange={(e) => {
            setQuote(e.target.value);
            if (source !== "photo-confirmed") setSource("typed");
          }}
          placeholder="e.g. 1900"
          required
        />
      </label>
      <label className="file-btn">
        Take or upload a price photo
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
      {photoUrl ? <img className="photo-preview" src={photoUrl} alt="Selected price photo" /> : null}
      {ocrNote ? <p className="hint">{reading ? "Reading photo…" : ocrNote}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <motion.button
        type="submit"
        className="btn btn-primary btn-lg"
        disabled={submitting || reading}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        whileHover={reduce ? undefined : { y: -2 }}
      >
        {submitting ? "Checking the stall book…" : "Check this price"}
      </motion.button>
      <p className="footnote">{catalog?.disclaimer}</p>
    </form>
  );
}
