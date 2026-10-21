import { test, expect, type Page } from "@playwright/test";
import { fixture, noOverflow } from "./admin.fixture";
test.use({ baseURL: "http://localhost:4175" });
async function authenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}
test("access: register native credentials, passkey login remains gated, device step-up, remove credentials", async ({
  page,
}) => {
  await authenticator(page);
  const state = await fixture(page);
  await page.getByRole("button", { name: "Administrar dispositivos" }).click();
  await page
    .getByRole("button", {
      name: "Registrar acceso con dispositivo",
      exact: true,
    })
    .click();
  await expect(page.getByText("Dispositivo local · Ingreso")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Registrar verificación con dispositivo",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("otra modalidad");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page
    .getByRole("button", {
      name: "Ingresar con huella, rostro o PIN",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verificación en dos pasos" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Usar código de respaldo" }).click();
  await page.getByLabel("Código de seis dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await page.getByRole("button", { name: "Administrar dispositivos" }).click();
  page.on("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Quitar Dispositivo local de ingreso" })
    .click();
  await expect(page.getByText("Dispositivo local · Ingreso")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Registrar verificación con dispositivo",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Mi dispositivo · Segunda verificación"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.getByLabel("Correo administrativo").fill("admin@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("Local-Fixture-Only-123!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.getByRole("button", { name: /Verificar con huella/ }).click();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Administrar dispositivos" }).click();
  await page
    .getByRole("button", { name: "Quitar Mi dispositivo de verificación" })
    .click();
  await expect(
    page.getByText("Mi dispositivo · Segunda verificación"),
  ).toHaveCount(0);
  expect(state.errors).toEqual([]);
  await noOverflow(page);
});
test("access: unsupported browser, cancelled ceremony and rejected password keep login closed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", {
      value: undefined,
      configurable: true,
    });
  });
  const state = await fixture(page, { logged: false });
  await page
    .getByRole("button", { name: "Ingresar con huella, rostro o PIN" })
    .click();
  await expect(page.getByRole("alert")).toContainText("no admite");
  await page.evaluate(() => {
    Object.defineProperty(window, "PublicKeyCredential", {
      value: class {},
      configurable: true,
    });
    navigator.credentials.get = async () => {
      throw new DOMException("local cancellation", "NotAllowedError");
    };
  });
  await page
    .getByRole("button", { name: "Ingresar con huella, rostro o PIN" })
    .click();
  await expect(page.getByRole("alert")).toContainText("canceló");
  await page.route("**/auth/v1/token?grant_type=password", (r) =>
    r.fulfill({
      status: 400,
      json: {
        error_code: "invalid_credentials",
        msg: "Invalid login credentials",
      },
    }),
  );
  await page.getByLabel("Correo administrativo").fill("admin@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("incorrect-password");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No pudimos completar");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
  await noOverflow(page);
});
test("access: recovery request checks HTTP errors and carries independent PKCE flow", async ({
  page,
}) => {
  await fixture(page, { logged: false });
  await page.route("**/auth/v1/recover**", async (r) => {
    const url = new URL(r.request().url());
    const redirect = new URL(url.searchParams.get("redirect_to")!);
    expect(redirect.searchParams.get("admin_recovery")).toBe("1");
    expect(redirect.searchParams.get("sb_flow_id")).toBeTruthy();
    expect(r.request().postDataJSON().code_challenge_method).toBe("s256");
    await r.fulfill({
      status: 429,
      json: {
        msg: "private server info",
        error_code: "over_email_send_rate_limit",
      },
    });
  });
  await page.getByLabel("Correo de recuperación").fill("admin@example.invalid");
  await page
    .getByRole("button", { name: "Enviar enlace de recuperación" })
    .click();
  await expect(page.getByRole("alert")).toContainText("No pudimos completar");
  await expect(page.getByText(/recibirá un enlace/)).toHaveCount(0);
  await page.unroute("**/auth/v1/recover**");
  await page
    .getByRole("button", { name: "Enviar enlace de recuperación" })
    .click();
  await expect(page.getByRole("status")).toContainText("recibirá un enlace");
  await noOverflow(page);
});
test("access: expired callback in hash is scrubbed without granting a session", async ({
  page,
}) => {
  await fixture(page, { logged: false });
  await page.goto(
    "/?admin_recovery=1#error=access_denied&error_code=otp_expired&error_description=private-fixture",
  );
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("enlace venció");
  expect(page.url()).not.toContain("private-fixture");
  await expect(
    page.getByRole("heading", { name: "Nueva contraseña" }),
  ).toHaveCount(0);
  await page.getByLabel("Correo administrativo").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Contraseña", { exact: true })).toBeFocused();
  await noOverflow(page);
});
test("access: recovery session at first level cannot set password until second verification", async ({
  page,
}) => {
  const state = await fixture(page, { aal: "aal1" });
  await page.evaluate(() =>
    sessionStorage.setItem(
      "vanta.admin.recovery.v1",
      "10000000-0000-0000-0000-000000000001",
    ),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Verificación en dos pasos" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nueva contraseña" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Usar código de respaldo" }).click();
  await page.getByLabel("Código de seis dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(
    page.getByRole("heading", { name: "Nueva contraseña" }),
  ).toBeVisible();
  await page.reload();
  // fixture restores the original aal1 session on a fresh page load; recovery intent survives.
  await expect(
    page.getByRole("heading", { name: "Verificación en dos pasos" }),
  ).toBeVisible();
  expect(state.writes).toEqual([]);
});

test("access: rejected recovery code never shows password editor or private workspace", async ({
  page,
}) => {
  const state = await fixture(page, { logged: false });
  await page.route("**/auth/v1/token?grant_type=pkce", (r) =>
    r.fulfill({
      status: 400,
      json: { error_code: "flow_state_expired", msg: "expired local fixture" },
    }),
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "vanta.admin.auth.v1-code-verifier",
      JSON.stringify("fixture-verifier/recovery"),
    ),
  );
  await page.goto("/?admin_recovery=1&code=expired-fixture#/admin");
  await expect(page.getByRole("alert")).toContainText("enlace venció");
  await expect(
    page.getByRole("heading", { name: "Nueva contraseña" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toHaveCount(0);
  expect(page.url()).not.toContain("expired-fixture");
  expect(state.writes).toEqual([]);
});
test("access: device verification cancellation preserves backup without unlocking workspace", async ({
  page,
}) => {
  const state = await fixture(page, { aal: "aal1", withDevice: true });
  await page.evaluate(() => {
    navigator.credentials.get = async () => {
      throw new DOMException("local cancellation", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: /Verificar con huella/ }).click();
  await expect(page.getByRole("alert")).toContainText("canceló");
  await expect(
    page.getByRole("button", { name: "Usar código de respaldo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toHaveCount(0);
  expect(state.writes).toEqual([]);
  await noOverflow(page);
});
