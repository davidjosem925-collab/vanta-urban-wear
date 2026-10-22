import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const server = Array.isArray(base.webServer)
  ? base.webServer[0]
  : base.webServer!;
export default defineConfig({
  ...base,
  testMatch: "**/admin-email.spec.ts",
  testIgnore: [],
  outputDir: "work/playwright-email-results",
  use: { ...base.use, baseURL: "http://127.0.0.1:4181" },
  webServer: {
    ...server,
    command: "npm run dev -- --host 127.0.0.1 --port 4181 --strictPort",
    url: "http://127.0.0.1:4181",
    env: { ...server.env, VITE_ADMIN_EMAIL_ACCESS_ENABLED: "true" },
  },
});
