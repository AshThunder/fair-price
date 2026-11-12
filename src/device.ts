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
