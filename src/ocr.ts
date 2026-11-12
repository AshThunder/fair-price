import { parsePriceFromText, type PriceHint } from "../shared/ocr";

/** Scale the photo so the longer side is about 1600px, grey it, and stretch the contrast. */
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = 1600 / Math.max(bitmap.width, bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = g;
    hist[g]++;
  }
  // Ignore the darkest and lightest 2% when stretching, like ImageOps.autocontrast.
  const total = w * h;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Read a price from a photo of a tag. Two layout passes; the parser prefers amounts with a currency mark. */
export async function readPriceFromPhoto(file: File, currency = "NGN"): Promise<PriceHint> {
  const Tesseract = (await import("tesseract.js")).default;
  const worker = await Tesseract.createWorker("eng");
  try {
    let source: HTMLCanvasElement | File = file;
    try {
      source = await prepare(file);
    } catch {
      source = file;
    }
    const texts: string[] = [];
    for (const psm of ["11", "3"]) {
      await worker.setParameters({ tessedit_pageseg_mode: psm as Tesseract.PSM });
      const { data } = await worker.recognize(source);
      texts.push(data.text ?? "");
      const hint = parsePriceFromText(texts.join("\n"), currency);
      if (hint.amount && hint.currencyGuess === currency) return hint;
    }
    return parsePriceFromText(texts.join("\n"), currency);
  } finally {
    await worker.terminate();
  }
}
