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
  await page
    .getByRole("button", {
      name: "Ingresar con huella, rostro o PIN",
      exact: true,
    })
    .click();
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
  await expect(page.getByRole("alert")).toContainText("El servicio rechazó");
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
  await expect(page.getByRole("alert")).toContainText(
    "Hay demasiados intentos",
  );
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
  await page
    .getByRole("button", {
      name: "Ingresar con huella, rostro o PIN",
      exact: true,
    })
    .click();
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

test("access: device is primary, heading announced without border, keyboard focus remains visible", async ({
  page,
}) => {
  const state = await fixture(page, { aal: "aal1", withDevice: true });
  const title = page.getByRole("heading", {
    name: "Verificación en dos pasos",
  });
  await expect(title).toBeFocused();
  await expect(title).toHaveCSS("outline-style", "none");
  const device = page.getByRole("button", {
    name: "Ingresar con huella, rostro o PIN",
    exact: true,
  });
  await expect(device).toHaveClass(/primary/);
  await expect(device).toHaveAccessibleDescription("Mi dispositivo");
  await expect(
    page.getByRole("button", { name: "Usar código de respaldo" }),
  ).toHaveClass(/secondary/);
  await page.keyboard.press("Tab");
  await expect(device).toBeFocused();
  await expect(device).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Usar código de respaldo" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Código de seis dígitos")).toBeVisible();
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});

test("access session: renewal and another tab's logout preserve AAL1 factor and input", async ({
  page,
}) => {
  const state = await fixture(page, { aal: "aal1" });
  await page.getByRole("button", { name: "Usar código de respaldo" }).click();
  await page.getByLabel("Código de seis dígitos").fill("123456");
  await page.evaluate(async () => {
    const { adminClient } = await import("/src/features/admin/client.ts");
    await adminClient!.auth.refreshSession();
  });
  await expect(page.getByLabel("Código de seis dígitos")).toHaveValue("123456");
  await page.evaluate(async () => {
    const channel = new BroadcastChannel("vanta.admin.auth.v1");
    channel.postMessage({ event: "SIGNED_OUT", session: null });
    channel.postMessage({
      event: "SIGNED_IN",
      session: {
        user: { id: "another-tab-user" },
        access_token: "not-adopted",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    channel.close();
  });
  await expect(page.getByLabel("Código de seis dígitos")).toHaveValue("123456");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});
test("access session: rejected code explains clock and preserves session for retry", async ({
  page,
}) => {
  const state = await fixture(page, { aal: "aal1" });
  let rejects = true;
  await page.route("**/auth/v1/factors/factor/verify", async (r) => {
    if (rejects) {
      rejects = false;
      return r.fulfill({
        status: 400,
        json: {
          error_code: "mfa_verification_failed",
          msg: "private fixture reason",
        },
      });
    }
    return r.fallback();
  });
  await page.getByRole("button", { name: "Usar código de respaldo" }).click();
  await page.getByLabel("Código de seis dígitos").fill("111111");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.getByRole("alert")).toContainText("El código no es válido");
  await expect(page.getByRole("alert")).not.toContainText("private fixture");
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toHaveCount(0);
  await page.getByLabel("Código de seis dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});
test("access session: server inspection failure blocks panel but can recover same session", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/auth/v1/user", (r) =>
    r.fulfill({
      status: 400,
      json: { error_code: "unexpected_failure", msg: "private fixture" },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Volver a comprobar el acceso" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Boolean(sessionStorage.getItem("vanta.admin.auth.v1")),
    ),
  ).toBe(true);
  await page.unroute("**/auth/v1/user");
  await page.getByRole("button", { name: "Reintentar comprobación" }).click();
  await expect(
    page.getByRole("heading", { name: "Productos", exact: true }),
  ).toBeVisible();
});
test("access session: multiple existing authenticators are selectable; no factor changes", async ({
  page,
}) => {
  await fixture(page, {
    aal: "aal1",
    totpDevices: [
      { id: "factor", friendly_name: "Celular anterior" },
      { id: "second-factor", friendly_name: "Celular actual" },
    ],
  });
  let mutations = 0;
  page.on("request", (r) => {
    if (
      /\/auth\/v1\/factors(?:\/[^/]+)?$/.test(new URL(r.url()).pathname) &&
      r.method() !== "GET"
    )
      mutations++;
  });
  await page.getByRole("button", { name: "Usar código de respaldo" }).click();
  await page
    .getByRole("combobox", { name: "Aplicación de códigos" })
    .selectOption("second-factor");
  await page.route("**/auth/v1/factors/second-factor/challenge", (r) =>
    r.fulfill({ json: { id: "challenge", type: "totp" } }),
  );
  await page.route("**/auth/v1/factors/second-factor/verify", (r) =>
    r.fulfill({
      status: 400,
      json: { error_code: "mfa_challenge_expired", msg: "expired" },
    }),
  );
  await page.getByLabel("Código de seis dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.getByRole("alert")).toContainText("verificación venció");
  expect(mutations).toBe(0);
});
test("access session: no device or authenticator explains setup without automatic enrollment", async ({
  page,
}) => {
  await fixture(page, { aal: "aal1", totpDevices: [] });
  let mutations = 0;
  page.on("request", (r) => {
    if (
      new URL(r.url()).pathname.startsWith("/auth/v1/factors") &&
      r.method() !== "GET"
    )
      mutations++;
  });
  await expect(
    page.getByText(/Todavía no hay dispositivos registrados/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Usar código de respaldo" }).click();
  await expect(page.getByRole("alert")).toContainText("No hay una aplicación");
  await expect(
    page.getByRole("button", { name: "Configurar aplicación de respaldo" }),
  ).toBeVisible();
  expect(mutations).toBe(0);
  await noOverflow(page);
});
test("access session: actual expired session returns to login with explanation", async ({
  page,
}) => {
  await fixture(page, { aal: "aal1" });
  await page.getByRole("button", { name: "Usar código de respaldo" }).click();
  await page.route("**/auth/v1/factors/factor/verify", (r) =>
    r.fulfill({
      status: 401,
      json: { error_code: "session_not_found", msg: "private session" },
    }),
  );
  await page.route("**/auth/v1/user", (r) =>
    r.fulfill({
      status: 401,
      json: { error_code: "session_not_found", msg: "private session" },
    }),
  );
  await page.getByLabel("Código de seis dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    /sesión.*(terminó|venció)/,
  );
});

test("access session: unsupported device explains limitation and leaves code available", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "PublicKeyCredential", {
      value: undefined,
      configurable: true,
    }),
  );
  await fixture(page, { aal: "aal1", withDevice: true });
  await expect(
    page.getByText(/Este navegador no admite la verificación con dispositivo/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Ingresar con huella, rostro o PIN",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Usar código de respaldo" }).click();
  await expect(page.getByLabel("Código de seis dígitos")).toBeVisible();
  await noOverflow(page);
});
