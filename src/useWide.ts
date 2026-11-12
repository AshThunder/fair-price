import { useEffect, useState } from "react";

/** True at the desktop breakpoint (1280px and wider). */
export function useWide(query = "(min-width: 1280px)"): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    on();
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}
