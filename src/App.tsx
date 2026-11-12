import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { useCatalog } from "./catalog";
import { HowPage } from "./components/HowItWorks";
import { detectCountry, getDemoFlag, saveCountry, setDemoFlag } from "./device";
import { Board } from "./pages/Board";
import { Home } from "./pages/Home";
import { MetricsPage } from "./pages/Metrics";

export function App() {
  const [params, setParams] = useSearchParams();
  const [demo, setDemo] = useState(() => getDemoFlag());
  const { catalog, error: catalogError, retry } = useCatalog();
  const [country, setCountryState] = useState<string | null>(null);

  // Pick the country once the catalog says which codes exist.
  useEffect(() => {
    if (catalog && !country) setCountryState(detectCountry((code) => catalog.countries.some((c) => c.code === code)));
  }, [catalog, country]);
  const setCountry = (code: string) => {
    saveCountry(code);
    setCountryState(code);
  };
  const cc = country ?? "US";

  useEffect(() => {
    setDemoFlag(demo);
    if (demo && params.get("demo") !== "1") {
      const next = new URLSearchParams(params);
      next.set("demo", "1");
      setParams(next, { replace: true });
    }
    if (!demo && params.has("demo")) {
      const next = new URLSearchParams(params);
      next.delete("demo");
      setParams(next, { replace: true });
    }
  }, [demo, params, setParams]);

  return (
    <Shell demo={demo} onDemo={setDemo}>
      <Routes>
        <Route
          path="/"
          element={
            <Home
              demo={demo}
              catalog={country ? catalog : null}
              catalogError={catalogError}
              onRetry={retry}
              country={cc}
              onCountry={setCountry}
            />
          }
        />
        <Route path="/board" element={<Board demo={demo} catalog={catalog} country={country} onCountry={setCountry} />} />
        <Route path="/how" element={<HowPage />} />
        <Route path="/metrics" element={<MetricsPage demo={demo} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
