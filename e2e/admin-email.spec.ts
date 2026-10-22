import { test, expect } from "@playwright/test";
import { fixture, noOverflow } from "./admin.fixture";
const key = "vanta.admin.email.auth.v1";
test("email: password AAL1 enters, persists across a new page, and logs out", async ({
  page,
  context,
}) => {
  const f = await fixture(page, { logged: false, emailMode: true });
  await page.getByText("Ingresar con contraseña", { exact: true }).click();
  await page.getByLabel("Correo administrativo").fill("admin@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("local-test-password");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Verificación en dos pasos", { exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate((k) => !!localStorage.getItem(k), key)).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toBeVisible();
  // A new page in the same browser sees persisted storage, but still checks server.
  const second = await context.newPage();
  const secondFixture = await fixture(second, {
    logged: false,
    emailMode: true,
  });
  await expect(
    second.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await second.bringToFront();
  await second.reload();
  await expect(
    second.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  expect([...f.writes, ...secondFixture.writes]).toEqual([]);
  await noOverflow(page);
});
test("email: request never creates users; hash link works without PKCE storage and requires confirmation", async ({
  page,
}) => {
  const f = await fixture(page, { logged: false, emailMode: true });
  let request: Record<string, unknown> | null = null,
    consumed = 0;
  await page.route("**/auth/v1/otp**", (route) => {
    request = route.request().postDataJSON();
    return route.fulfill({ json: {} });
  });
  await page
    .getByLabel("Correo para recibir el enlace")
    .fill("admin@example.invalid");
  await page.getByRole("button", { name: "Recibir enlace de acceso" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Si el correo corresponde",
  );
  expect(request).toMatchObject({
    create_user: false,
    email: "admin@example.invalid",
  });
  await page.route("**/auth/v1/verify", (route) => {
    consumed++;
    return route.fulfill({ json: f.session("aal1") });
  });
  await page.goto("/?admin_email=1&token_hash=local-only&type=email#/admin");
  await expect(
    page.getByRole("heading", { name: "Confirmar ingreso" }),
  ).toBeVisible();
  expect(page.url()).not.toContain("token_hash");
  expect(consumed).toBe(0);
  await page.getByRole("button", { name: "Continuar con este enlace" }).click();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toBeVisible();
  expect(consumed).toBe(1);
  await noOverflow(page);
  expect(f.errors).toEqual([]);
});
test("email: invalid, expired and reused links show safe errors without a private workspace", async ({
  page,
}) => {
  const f = await fixture(page, { logged: false, emailMode: true });
  await page.route("**/auth/v1/verify", (route) =>
    route.fulfill({
      status: 403,
      json: { error_code: "otp_expired", msg: "PRIVATE DETAILS" },
    }),
  );
  for (const type of ["expired", "reused"]) {
    await page.goto(`/?admin_email=1&token_hash=${type}&type=email#/admin`);
    await page
      .getByRole("button", { name: "Continuar con este enlace" })
      .click();
    await expect(page.getByRole("alert")).toContainText("venció, ya se usó");
    await expect(page.getByRole("alert")).not.toContainText("PRIVATE");
    await expect(
      page.getByRole("link", { name: "+ Agregar producto", exact: true }),
    ).toHaveCount(0);
  }
  await page.goto(
    "/?admin_email=1&token_hash=wrong-purpose&type=recovery#/admin",
  );
  await expect(page.getByRole("alert")).toContainText("no es válido");
  expect(f.writes).toEqual([]);
  await noOverflow(page);
});
test("email: inactive/non-members and missing server transition never enter", async ({
  page,
}) => {
  await fixture(page, { logged: false, emailMode: true, member: false });
  await page.getByText("Ingresar con contraseña", { exact: true }).click();
  await page
    .getByLabel("Correo administrativo")
    .fill("ordinary@example.invalid");
  await page
    .getByLabel("Contraseña", { exact: true })
    .fill("local-test-password");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Acceso no autorizado" }),
  ).toBeVisible();
  await page.route("**/rest/v1/rpc/admin_membership", (r) =>
    r.fulfill({ json: true }),
  );
  await page.route("**/rest/v1/rpc/admin_access_mode", (r) =>
    r.fulfill({ status: 404, json: { message: "not migrated" } }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Volver a comprobar el acceso" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toHaveCount(0);
});
test("email: recovery without factors changes password and logs out; existing factors still protect that action", async ({
  page,
}) => {
  const f = await fixture(page, {
    logged: false,
    emailMode: true,
    totpDevices: [],
  });
  await page.route("**/auth/v1/verify", (r) =>
    r.fulfill({ json: f.session("aal1") }),
  );
  await page.goto(
    "/?admin_recovery=1&token_hash=recovery-demo&type=recovery#/admin",
  );
  await page.getByRole("button", { name: "Continuar con este enlace" }).click();
  await expect(
    page.getByRole("heading", { name: "Nueva contraseña" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Nueva contraseña", { exact: true })
    .fill("New-local-password-123!");
  await page.getByLabel("Repetir contraseña").fill("New-local-password-123!");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Contraseña actualizada",
  );
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  expect(f.errors).toEqual([]);
  await noOverflow(page);
});
test("email: recovery of a user with TOTP preserves the provider's sensitive-action requirement", async ({
  page,
}) => {
  const f = await fixture(page, { logged: false, emailMode: true });
  await page.route("**/auth/v1/verify", (r) =>
    r.fulfill({ json: f.session("aal1") }),
  );
  await page.goto(
    "/?admin_recovery=1&token_hash=recovery-demo&type=recovery#/admin",
  );
  await page.getByRole("button", { name: "Continuar con este enlace" }).click();
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
});
test("email: PKCE uses this browser's verifier and rejects a callback without it", async ({
  page,
}) => {
  const f = await fixture(page, { logged: false, emailMode: true });
  let redirect = "";
  let verifier: unknown = null;
  await page.route("**/auth/v1/otp**", (r) => {
    redirect = new URL(r.request().url()).searchParams.get("redirect_to") ?? "";
    return r.fulfill({ json: {} });
  });
  await page
    .getByLabel("Correo para recibir el enlace")
    .fill("admin@example.invalid");
  await page.getByRole("button", { name: "Recibir enlace de acceso" }).click();
  await expect(page.getByRole("status")).toContainText("recibirás");
  await page.route("**/auth/v1/token?grant_type=pkce", (r) => {
    verifier = r.request().postDataJSON().code_verifier;
    return r.fulfill({ json: f.session("aal1") });
  });
  const flowId = redirect
    ? new URL(redirect).searchParams.get("sb_flow_id")
    : null;
  await page.goto(
    `/?admin_email=1&code=local-pkce${flowId ? `&sb_flow_id=${encodeURIComponent(flowId)}` : ""}#/admin`,
  );
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toBeVisible();
  expect(typeof verifier).toBe("string");
  expect((verifier as string).length).toBeGreaterThan(20);
  expect(page.url()).not.toContain("code=");
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await page.evaluate(() => localStorage.clear());
  await page.route("**/auth/v1/token?grant_type=pkce", (r) =>
    r.fulfill({
      status: 400,
      json: { error_code: "bad_code_verifier", msg: "private" },
    }),
  );
  await page.goto("/?admin_email=1&code=other-browser#/admin");
  await expect(page.getByRole("alert")).toContainText("otro navegador");
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toHaveCount(0);
});
test("email: server denial blocks a persisted session and global logout uses the official scope", async ({
  page,
}) => {
  await fixture(page, { logged: false, emailMode: true });
  const alternative = page.getByText("Ingresar con contraseña", {
    exact: true,
  });
  await alternative.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Correo administrativo").fill("admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("local-password");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toBeVisible();
  let scope = "";
  await page.route("**/auth/v1/logout**", (r) => {
    scope = new URL(r.request().url()).searchParams.get("scope") ?? "";
    return r.fulfill({ status: 204 });
  });
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Cerrar todas las sesiones" }).click();
  await expect(
    page.getByRole("heading", { name: "Ingresá a VANTA" }),
  ).toBeVisible();
  expect(scope).toBe("global");
  await page.getByText("Ingresar con contraseña", { exact: true }).click();
  await page.getByLabel("Correo administrativo").fill("admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("local-password");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toBeVisible();
  await page.route("**/rest/v1/rpc/is_admin", (r) =>
    r.fulfill({ json: false }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Acceso no autorizado" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toHaveCount(0);
  await noOverflow(page);
});
test("email: rejected logout hides private data and never reports a completed logout", async ({
  page,
}) => {
  await fixture(page, { logged: false, emailMode: true });
  await page.getByText("Ingresar con contraseña", { exact: true }).click();
  await page.getByLabel("Correo administrativo").fill("admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("local-password");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toBeVisible();
  await page.route("**/auth/v1/logout**", (r) =>
    r.fulfill({
      status: 400,
      json: { error_code: "unexpected_failure", msg: "private details" },
    }),
  );
  await page
    .getByRole("button", { name: "Cerrar sesión", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "No pudimos confirmar el cierre",
  );
  await expect(
    page.getByRole("heading", { name: "Volver a comprobar el acceso" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "+ Agregar producto", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).not.toContainText("private");
});
