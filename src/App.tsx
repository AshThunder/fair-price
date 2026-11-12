import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { getDemoFlag, setDemoFlag } from "./device";
import { Board } from "./pages/Board";
import { Home } from "./pages/Home";
import { MetricsPage } from "./pages/Metrics";

export function App() {
  const [params, setParams] = useSearchParams();
  const [demo, setDemo] = useState(() => getDemoFlag());

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
        <Route path="/" element={<Home demo={demo} />} />
        <Route path="/board" element={<Board demo={demo} />} />
        <Route path="/metrics" element={<MetricsPage demo={demo} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
