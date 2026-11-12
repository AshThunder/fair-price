import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import app from "./app.js";
import { PORT, ROOT } from "./env.js";

const publicDir = join(ROOT, "dist/public");
if (existsSync(publicDir)) {
  app.use("/*", serveStatic({ root: publicDir }));
  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found." }, 404);
    const { readFileSync } = await import("node:fs");
    return c.html(readFileSync(join(publicDir, "index.html"), "utf8"));
  });
}

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  process.stdout.write(`Fair Price API on http://127.0.0.1:${info.port}\n`);
});
