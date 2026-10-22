import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [
    "**/orders.spec.ts",
    "**/admin-email.spec.ts",
    "**/payments.spec.ts",
    "**/notifications.spec.ts",
  ],
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  outputDir: "work/playwright-results",
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 960 } } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-393",
      use: {
        viewport: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "small-mobile",
      use: {
        viewport: { width: 320, height: 640 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    env: {
      // Browser fixtures only: all calls to this fake host are intercepted by Playwright.
      VITE_SUPABASE_URL: "https://vanta-cart-fixture.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_browser_fixture_only",
      VITE_ADMIN_PASSKEYS_ENABLED: "true",
      VITE_ADMIN_DEVICE_MFA_ENABLED: "true",
      VITE_ADMIN_RP_ID: "localhost",
      VITE_ADMIN_EMAIL_ACCESS_ENABLED: "false",
      VITE_DEMO_EMAIL_ENABLED: "false",
      VITE_DEMO_ORDERS_ENABLED: "false",
      VITE_MP_CHECKOUT_ENABLED: "false",
      VITE_TURNSTILE_SITE_KEY: "",
    },
  },
});
