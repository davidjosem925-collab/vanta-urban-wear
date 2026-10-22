import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/payments.spec.ts",
  outputDir: "work/playwright-payments-results",
  use: { ...base.use, baseURL: "http://127.0.0.1:4176" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4176 --strictPort",
    url: "http://127.0.0.1:4176",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://vanta-cart-fixture.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_browser_fixture_only",
      VITE_DEMO_EMAIL_ENABLED: "false",
      VITE_DEMO_ORDERS_ENABLED: "true",
      VITE_TURNSTILE_SITE_KEY: "test-public-sitekey",
      VITE_MP_CHECKOUT_ENABLED: "true",
    },
  },
});
