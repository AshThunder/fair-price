import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests never touch a real database or live APIs: in-memory PGlite, no keys.
    env: {
      FAIRPRICE_STORE: "memory",
      DATABASE_URL: "",
      POSTGRES_URL: "",
      OPENSERV_API_KEY: "",
      SERV_API_KEY: "",
      REPPO_API_KEY: "",
      FAIRPRICE_TELEGRAM_BOT_TOKEN: "",
    },
    testTimeout: 20000,
  },
});
