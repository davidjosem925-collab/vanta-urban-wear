import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  adminClient as client,
  rpc,
  ADMIN_AUTH_STORAGE_KEY,
  adminSessionStorage,
} from "./client";
import { AdminWorkspace } from "./Workspace";
import "./admin.css";
import { clearAdminPreviews } from "./previews";
import { AccessDevices } from "./AccessDevices";
import {
  accessError,
  isSessionError,
  deviceConfigurationValid,
  deviceMfaEnabled,
  deviceRpId,
  deviceSupported,
  passkeysEnabled,
} from "./access";
import { verifyDevice } from "./deviceVerification";
import {
  emailAccessEnabled,
  readEmailCallback,
  requestAdminLink,
  linkError,
  type EmailCallback,
} from "./emailAccess";
function AccessAlternative({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return emailAccessEnabled ? (
    <details className="admin-access-alternative">
      <summary>{title}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}
export function AdminPage() {
  const [session, setSession] = useState<Session | null>(null),
    [state, setState] = useState<
      "loading" | "signing-out" | "login" | "mfa" | "ready" | "denied" | "retry"
    >("loading");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [factor, setFactor] = useState(""),
    [qr, setQr] = useState(""),
    [recovery, setRecovery] = useState(false);
  const [pendingLink, setPendingLink] = useState<Extract<
    EmailCallback,
    { kind: "hash" }
  > | null>(null);
  const linkConfirming = useRef(false);
  const signingOut = useRef(false);
  const ceremony = useRef<AbortController | null>(null);
  const [deviceFactors, setDeviceFactors] = useState<
    { id: string; friendly_name?: string }[]
  >([]);
  const sessionIdentity = useRef<string | null>(null);
  const [totpFactors, setTotpFactors] = useState<
    { id: string; friendly_name?: string }[]
  >([]);
  const [canEnroll, setCanEnroll] = useState(false);
  const generation = useRef(0);
  const authorizedUser = useRef<string | null>(null);
  const [authRevision, setAuthRevision] = useState(0);
  const initialCallback = useRef(new URL(location.href));
  const processingCallback = useRef(
    emailAccessEnabled &&
      readEmailCallback(initialCallback.current).kind !== "none",
  );
  const exchange = useRef<Promise<{ error: unknown }> | null>(null);
  const deny = useCallback(() => {
    authorizedUser.current = null;
    clearAdminPreviews();
    setState("denied");
    setSession(null);
  }, []);
  const inspect = useCallback(async () => {
    if (processingCallback.current || signingOut.current) return;
    const id = ++generation.current;
    if (!client) {
      setState("login");
      return;
    }
    try {
      const { data: s, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (id !== generation.current) return;
      setSession(s.session);
      if (!s.session) {
        if (sessionIdentity.current)
          setError(
            "Tu sesión terminó o venció. Volvé a ingresar; no hace falta cambiar tu contraseña.",
          );
        sessionIdentity.current = null;
        setFactor("");
        setQr("");
        setDeviceFactors([]);
        setTotpFactors([]);
        setCanEnroll(false);
        setRecovery(false);
        sessionStorage.removeItem("vanta.admin.recovery.v1");
        authorizedUser.current = null;
        clearAdminPreviews();
        setState("login");
        return;
      }
      const { data: userData, error } = await client.auth.getUser();
      if (error) throw error;
      if (id !== generation.current) return;
      if (!userData.user || userData.user.id !== s.session.user.id)
        throw new Error("identity mismatch");
      if (sessionIdentity.current !== userData.user.id) {
        setFactor("");
        setQr("");
      }
      sessionIdentity.current = userData.user.id;
      const factors = userData.user.factors ?? [];
      setTotpFactors(
        factors.filter(
          (f) => f.factor_type === "totp" && f.status === "verified",
        ),
      );
      setDeviceFactors(
        factors.filter(
          (f) => f.factor_type === "webauthn" && f.status === "verified",
        ),
      );
      setCanEnroll(!factors.some((f) => f.status === "verified"));
      setFactor((current) =>
        current && !factors.some((f) => f.id === current) ? "" : current,
      );
      if (!(await rpc<boolean>("admin_membership", {}))) {
        if (id === generation.current) {
          authorizedUser.current = null;
          clearAdminPreviews();
          setState("denied");
        }
        return;
      }
      if (
        emailAccessEnabled &&
        (await rpc<string>("admin_access_mode", {})) !== "email"
      )
        throw new Error("transition unavailable");
      const { data, error: aalError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      const recovering =
        sessionStorage.getItem("vanta.admin.recovery.v1") === s.session.user.id;
      if (recovering) setRecovery(true);
      const recoveryNeedsMfa =
        recovering &&
        factors.some((f) => f.status === "verified") &&
        data.currentLevel !== "aal2";
      const allowed =
        (emailAccessEnabled || data.currentLevel === "aal2") &&
        (await rpc<boolean>("is_admin", {}));
      if (!emailAccessEnabled && data.currentLevel === "aal2" && !allowed)
        throw new Error("denied");
      if (id !== generation.current) return;
      if (emailAccessEnabled && !allowed) {
        deny();
        return;
      }
      authorizedUser.current =
        allowed && !recoveryNeedsMfa ? s.session.user.id : null;
      setState(allowed && !recoveryNeedsMfa ? "ready" : "mfa");
    } catch (error) {
      if (id !== generation.current) return;
      authorizedUser.current = null;
      clearAdminPreviews();
      setState("retry");
      setError(
        isSessionError(error)
          ? accessError(error)
          : "No pudimos comprobar tu acceso con el servidor. Tu sesión local no se cerró. Revisá la conexión y volvé a comprobar el acceso.",
      );
    }
  }, [deny]);
  useEffect(() => {
    const counter = generation;
    let active = true;
    async function initial() {
      const url = initialCallback.current,
        code = url.searchParams.get("code");
      if (emailAccessEnabled) {
        const callback = readEmailCallback(url);
        if (callback.kind !== "none") {
          history.replaceState(null, "", `${url.pathname}#/admin`);
          if (callback.kind === "invalid") {
            processingCallback.current = false;
            setError(linkError);
            setState("login");
            return;
          }
          if (callback.kind === "hash") {
            setPendingLink(callback);
            setState("login");
            return;
          }
          if (!client) {
            processingCallback.current = false;
            setError(linkError);
            setState("login");
            return;
          }
          exchange.current ??= client.auth.exchangeCodeForSession(
            callback.code,
            callback.flowId ? { flowId: callback.flowId } : undefined,
          );
          const result = await exchange.current;
          if (!active) return;
          if (result.error) {
            processingCallback.current = false;
            setError(
              "El enlace venció, ya se usó o se abrió en otro navegador. Solicitá uno nuevo desde este dispositivo.",
            );
            setState("login");
            return;
          }
          if (callback.recovery) {
            sessionStorage.setItem(
              "vanta.admin.recovery.v1",
              (await client.auth.getSession()).data.session?.user.id ?? "",
            );
            setRecovery(true);
          }
        }
        processingCallback.current = false;
        if (active) void inspect();
        return;
      }

      if (
        url.searchParams.get("admin_recovery") === "1" &&
        (url.searchParams.has("error") || url.hash.includes("error="))
      ) {
        history.replaceState(null, "", `${url.pathname}#/admin`);
        setError("El enlace venció o no es válido. Solicitá uno nuevo.");
        setState("login");
        return;
      }
      if (code && url.searchParams.get("admin_recovery") === "1" && client) {
        history.replaceState(null, "", `${url.pathname}#/admin`);
        // Capture the SDK flow slot before removing credentials from the URL.
        const flowId = url.searchParams.get("sb_flow_id");
        exchange.current ??= client.auth.exchangeCodeForSession(
          code,
          flowId === null ? undefined : { flowId },
        );
        const { error } = await exchange.current;
        if (!active) return;
        if (error) {
          setError(
            "El enlace venció o no corresponde a este navegador. Solicitá uno nuevo.",
          );
          setState("login");
          return;
        }
        sessionStorage.setItem(
          "vanta.admin.recovery.v1",
          (await client.auth.getSession()).data.session?.user.id ?? "",
        );
        setRecovery(true);
      }
      if (active) void inspect();
    }
    void initial().catch(() => {
      if (active) {
        processingCallback.current = false;
        setError("No se pudo recuperar la sesión. Solicitá un enlace nuevo.");
        setState("login");
      }
    });
    const sub = client?.auth.onAuthStateChange(() => {
      if (!active || processingCallback.current || signingOut.current) return;
      generation.current++;
      setAuthRevision((v) => v + 1);
      // Auth storage is tab-scoped; SDK notifications may originate in another
      // tab. Never adopt its session, clear our factor or trust its AAL.
      // inspect() re-reads this tab's session and validates it with the server.
      let hidePrivateView = true;
      // Untrusted identity is only a UI hint. It can hide a stale private view,
      // never open one: inspect() still validates Auth, active membership and AAL.
      // Foreign broadcasts never overwrite this tab's SDK storage.
      try {
        const raw = adminSessionStorage().getItem(ADMIN_AUTH_STORAGE_KEY);
        const own = raw ? JSON.parse(raw) : null;
        hidePrivateView = !own || own.user?.id !== sessionIdentity.current;
      } catch {
        /* A malformed/missing hint must hide private UI. */
      }
      if (hidePrivateView) {
        authorizedUser.current = null;
        clearAdminPreviews();
        setState("loading");
      }
    });
    const focus = () => {
      if (active) void inspect();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      counter.current++;
      ceremony.current?.abort();
      sub?.data.subscription.unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, [inspect]);
  // Never await Supabase calls inside onAuthStateChange's SDK lock.
  useEffect(() => {
    if (authRevision) void inspect();
  }, [authRevision, inspect]);
  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (error) {
      setError(accessError(error));
      if (isSessionError(error)) await inspect();
    } finally {
      setBusy(false);
    }
  }
  async function logout(scope: "local" | "global" = "local") {
    const inFlight = Boolean(
      document.querySelector('[data-admin-saving="true"]'),
    );
    if (
      (inFlight || document.querySelector('[data-admin-dirty="true"]')) &&
      !window.confirm(
        inFlight
          ? "Hay una operación en curso y puede completarse aunque cierres sesión. ¿Querés continuar?"
          : "Tenés cambios sin guardar. ¿Querés descartarlos y cerrar sesión?",
      )
    )
      return;
    authorizedUser.current = null;
    clearAdminPreviews();
    sessionIdentity.current = null;
    generation.current++;
    signingOut.current = true;
    setState("signing-out");
    try {
      const result = await client?.auth.signOut({ scope });
      if (result?.error) throw result.error;
      setSession(null);
      setQr("");
      setFactor("");
      setRecovery(false);
      sessionStorage.removeItem("vanta.admin.recovery.v1");
      setState("login");
    } catch {
      setState("retry");
      throw { code: "admin_logout_unconfirmed" };
    } finally {
      signingOut.current = false;
    }
  }
  async function setup() {
    if (!client) return;
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw error;
    const existing = data.totp.find((f) => f.status === "verified");
    if (existing) {
      setFactor(existing.id);
      return;
    }
    setError(
      "No hay una aplicación de códigos verificada disponible. Si perdiste tu segundo paso, pedile al propietario que recupere el acceso de forma segura.",
    );
  }
  async function enrollBackup() {
    if (!client || !canEnroll) return;
    const current = await client.auth.mfa.listFactors();
    if (current.error) throw current.error;
    if (current.data.all.some((f) => f.status === "verified")) {
      setError(
        "Ya hay un método registrado. Actualizá los métodos y usá uno existente.",
      );
      return;
    }
    const enrolled = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `VANTA ${crypto.randomUUID().slice(0, 8)}`,
    });
    if (enrolled.error) throw enrolled.error;
    setFactor(enrolled.data.id);
    setQr(enrolled.data.totp.qr_code);
  }
  useEffect(() => {
    const h = document.querySelector<HTMLElement>(".admin-shell h2");
    if (h) {
      h.tabIndex = -1;
      h.dataset.adminFocusTitle = "true";
      h.focus({ preventScroll: true });
    }
  }, [state]);
  return (
    <section className="admin-shell" aria-labelledby="admin-title">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">VANTA / ACCESO PRIVADO</p>
          <h1 id="admin-title">Administración</h1>
          <p>Tu colección, en orden. Administrá cada detalle de VANTA.</p>
        </div>
        {session && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void action(() => logout())}
          >
            Cerrar sesión
          </button>
        )}
      </header>
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p
          className="admin-notice"
          role="status"
          aria-label="Avisos de la cuenta"
        >
          {notice}
        </p>
      )}
      {state === "loading" && (
        <p role="status" aria-label="Verificación del acceso">
          Verificando acceso…
        </p>
      )}
      {state === "signing-out" && (
        <p role="status" aria-label="Cierre de sesión">
          Cerrando sesión…
        </p>
      )}
      {state === "retry" && (
        <div className="admin-card admin-auth">
          <h2>Volver a comprobar el acceso</h2>
          <p>
            El panel permanece bloqueado hasta validar la sesión con el
            servidor.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void action(inspect)}
          >
            Reintentar comprobación
          </button>
        </div>
      )}
      {state === "denied" && (
        <div className="admin-card">
          <h2>Acceso no autorizado</h2>
          <p>
            Se requiere una cuenta administrativa activa. El registro público no
            concede permisos.
          </p>
          <button
            className="button secondary"
            onClick={() => void action(() => logout())}
          >
            Volver al acceso
          </button>
        </div>
      )}
      {state === "login" && pendingLink && (
        <div className="admin-card admin-auth">
          <h2>
            {pendingLink.recovery ? "Recuperar tu acceso" : "Confirmar ingreso"}
          </h2>
          <p>
            Continuá solo si solicitaste este enlace para ingresar a VANTA en
            este dispositivo.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                if (linkConfirming.current || !client) return;
                linkConfirming.current = true;
                const link = pendingLink;
                setPendingLink(null);
                try {
                  const result = await client.auth.verifyOtp({
                    token_hash: link.token,
                    type: link.recovery ? "recovery" : "email",
                  });
                  if (result.error || !result.data.session) {
                    processingCallback.current = false;
                    setError(linkError);
                    return;
                  }
                  if (link.recovery) {
                    sessionStorage.setItem(
                      "vanta.admin.recovery.v1",
                      result.data.session.user.id,
                    );
                    setRecovery(true);
                  }
                  processingCallback.current = false;
                  await inspect();
                } finally {
                  processingCallback.current = false;
                  linkConfirming.current = false;
                }
              })
            }
          >
            Continuar con este enlace
          </button>
          <button
            className="button secondary"
            onClick={() => {
              processingCallback.current = false;
              setPendingLink(null);
              setError("");
            }}
          >
            Cancelar
          </button>
        </div>
      )}
      {state === "login" && !pendingLink && (
        <div className="admin-card admin-auth">
          <h2>Ingresá a VANTA</h2>
          {!client && (
            <p role="alert">
              Configurá las variables públicas de Supabase para habilitar el
              acceso.
            </p>
          )}
          {emailAccessEnabled && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const email = String(
                  new FormData(e.currentTarget).get("email"),
                );
                void action(async () => {
                  const result = await requestAdminLink(email);
                  if (result.error) throw result.error;
                  setNotice(
                    "Si el correo corresponde a una cuenta habilitada, recibirás un enlace de un solo uso. Revisá también la carpeta de spam.",
                  );
                });
              }}
            >
              <label>
                Correo para recibir el enlace
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                />
              </label>
              <button className="button primary" disabled={busy || !client}>
                Recibir enlace de acceso
              </button>
              <p>
                Abrilo en el dispositivo donde querés administrar la tienda.
              </p>
            </form>
          )}
          <AccessAlternative title="Ingresar con contraseña">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(async () => {
                  if (!client) return;
                  const { error } = await client.auth.signInWithPassword({
                    email: String(f.get("email")),
                    password: String(f.get("password")),
                  });
                  if (error) throw error;
                  await inspect();
                });
              }}
            >
              <label>
                Correo administrativo
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                />
              </label>
              <label>
                Contraseña
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={200}
                />
              </label>
              <button
                className={`button ${emailAccessEnabled ? "secondary" : "primary"}`}
                disabled={busy || !client}
              >
                Ingresar
              </button>
            </form>
          </AccessAlternative>
          {!emailAccessEnabled &&
            passkeysEnabled &&
            deviceSupported() &&
            client && (
              <>
                <button
                  className="button secondary"
                  disabled={busy || !client}
                  onClick={() =>
                    void action(async () => {
                      if (!deviceSupported()) {
                        setError(
                          "Este navegador no admite el acceso con dispositivo. Usá tu correo y contraseña.",
                        );
                        return;
                      }
                      ceremony.current?.abort();
                      ceremony.current = new AbortController();
                      const r = await client!.auth.signInWithPasskey({
                        options: { signal: ceremony.current.signal },
                      });
                      if (r.error) throw r.error;
                      await inspect();
                    })
                  }
                >
                  Ingresar con huella, rostro o PIN
                </button>
                <p>
                  Si tu cuenta lo requiere, completá después la segunda
                  verificación con tu dispositivo o código de respaldo.
                </p>
              </>
            )}
          <AccessAlternative title="Recuperar contraseña">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const email = String(
                  new FormData(e.currentTarget).get("email"),
                );
                void action(async () => {
                  const redirect = new URL(location.pathname, location.origin);
                  redirect.searchParams.set("admin_recovery", "1");
                  redirect.hash = "/admin";
                  const result = await client!.auth.resetPasswordForEmail(
                    email,
                    {
                      redirectTo: redirect.toString(),
                    },
                  );
                  if (result.error) throw result.error;
                  setNotice(
                    emailAccessEnabled
                      ? "Si la cuenta puede recuperar el acceso, recibirá un enlace temporal. Abrilo en el dispositivo donde quieras recuperar tu acceso."
                      : "Si la cuenta puede recuperar el acceso, recibirá un enlace. Abrilo en este mismo navegador.",
                  );
                });
              }}
            >
              <h3>Recuperar contraseña</h3>
              <label>
                Correo de recuperación
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                />
              </label>
              <button className="button secondary" disabled={busy || !client}>
                Enviar enlace de recuperación
              </button>
            </form>
          </AccessAlternative>
        </div>
      )}
      {state === "mfa" && (
        <div className="admin-card admin-auth">
          <h2>Verificación en dos pasos</h2>
          {emailAccessEnabled && recovery && (
            <p>
              Para cambiar tu contraseña, tu cuenta conserva una verificación
              adicional. Completala con tu método de respaldo; no se pide para
              el ingreso habitual.
            </p>
          )}
          <p>
            Confirmá que sos vos con un dispositivo registrado. También podés
            usar el código actual de tu aplicación de respaldo. Si es tu primer
            acceso, configurá esa aplicación y conservá su recuperación por un
            canal seguro.
          </p>
          <div className="admin-method-status" role="status">
            {!deviceMfaEnabled ? (
              <p>
                Huella, rostro o PIN: este método no está activado en esta
                instalación. Necesita habilitarse en el servicio y después
                registrar un dispositivo desde Seguridad del acceso. Mientras
                tanto, usá tu aplicación de códigos.
              </p>
            ) : !deviceConfigurationValid() ? (
              <p>
                El acceso con dispositivo necesita completar la configuración
                del sitio. Usá tu aplicación de códigos mientras se corrige.
              </p>
            ) : !deviceSupported() ? (
              <p>
                Este navegador no admite la verificación con dispositivo. Probá
                un navegador compatible o usá tu aplicación de códigos.
              </p>
            ) : !deviceFactors.length ? (
              <p>
                Todavía no hay dispositivos registrados. Ingresá con tu
                aplicación y registrá uno desde Seguridad del acceso, una vez
                habilitado el servicio.
              </p>
            ) : (
              <p>
                Disponible: verificación con tu dispositivo registrado. También
                podés usar tu aplicación de códigos.
              </p>
            )}
          </div>
          {canEnroll && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void action(enrollBackup)}
            >
              Configurar aplicación de respaldo
            </button>
          )}
          {deviceMfaEnabled &&
            deviceSupported() &&
            deviceConfigurationValid() &&
            deviceFactors.map((d) => (
              <div key={d.id} className="admin-device-option">
                <button
                  aria-describedby={`admin-device-${d.id}`}
                  className="button primary"
                  disabled={
                    busy || !deviceSupported() || !deviceConfigurationValid()
                  }
                  onClick={() =>
                    void action(async () => {
                      if (!deviceSupported() || !deviceConfigurationValid()) {
                        setError(
                          "Este dispositivo o la configuración no son compatibles. Usá el código de respaldo.",
                        );
                        return;
                      }
                      ceremony.current?.abort();
                      ceremony.current = new AbortController();
                      const r = await verifyDevice(
                        {
                          factorId: d.id,
                          webauthn: {
                            rpId: deviceRpId,
                            rpOrigins: [location.origin],
                            signal: ceremony.current.signal,
                          },
                        },
                        { userVerification: "required" },
                      );
                      if (r.error) throw r.error;
                      await inspect();
                    })
                  }
                >
                  Ingresar con huella, rostro o PIN
                </button>
                <p id={`admin-device-${d.id}`}>
                  {d.friendly_name || "Dispositivo registrado"}
                </p>
              </div>
            ))}
          {deviceMfaEnabled &&
            deviceSupported() &&
            deviceConfigurationValid() &&
            deviceFactors.length > 0 && (
              <p>
                Si elegís usar otro dispositivo, seguí las indicaciones del
                navegador. Si muestra un QR, escanealo con ese teléfono y
                confirmá allí.
              </p>
            )}
          {!factor ? (
            <button
              className={`button ${deviceMfaEnabled && deviceFactors.length && deviceSupported() && deviceConfigurationValid() ? "secondary" : "primary"}`}
              disabled={busy}
              onClick={() => void action(setup)}
            >
              Usar código de respaldo
            </button>
          ) : (
            <>
              <div>
                {qr && (
                  <img
                    className="admin-qr"
                    src={qr}
                    alt="Código QR para configurar tu autenticador"
                    width="200"
                    height="200"
                  />
                )}
              </div>
              {totpFactors.length > 1 && (
                <label>
                  Aplicación de códigos
                  <select
                    aria-label="Aplicación de códigos"
                    value={factor}
                    onChange={(e) => setFactor(e.target.value)}
                    disabled={busy}
                  >
                    {totpFactors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.friendly_name || "Aplicación registrada"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = String(
                    new FormData(e.currentTarget).get("code"),
                  );
                  void action(async () => {
                    const result = await client!.auth.mfa.challengeAndVerify({
                      factorId: factor,
                      code,
                    });
                    if (result.error) throw result.error;
                    setQr("");
                    await inspect();
                  });
                }}
              >
                <label>
                  Código de seis dígitos
                  <input
                    name="code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  Verificar código
                </button>
              </form>
            </>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await inspect();
              })
            }
          >
            Actualizar métodos disponibles
          </button>
        </div>
      )}
      {state === "ready" && recovery && (
        <div className="admin-card admin-auth">
          <h2>Nueva contraseña</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                password = String(f.get("password"));
              if (password !== f.get("repeat")) {
                setError("Las contraseñas no coinciden.");
                return;
              }
              void action(async () => {
                const { error } = await client!.auth.updateUser({ password });
                if (error) throw error;
                setNotice("Contraseña actualizada. Cerrando tus sesiones…");
                try {
                  await logout(emailAccessEnabled ? "global" : "local");
                  setNotice(
                    "Contraseña actualizada. Volvé a ingresar con tu nueva contraseña.",
                  );
                } catch (error) {
                  setNotice(
                    "Contraseña actualizada. No se pudo confirmar el cierre de las sesiones.",
                  );
                  throw error;
                }
              });
            }}
          >
            <label>
              Nueva contraseña
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                required
              />
            </label>
            <label>
              Repetir contraseña
              <input
                name="repeat"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                required
              />
            </label>
            <button className="button primary" disabled={busy}>
              Guardar contraseña
            </button>
          </form>
        </div>
      )}
      {state === "ready" && !recovery && session && (
        <>
          {!emailAccessEnabled && <AccessDevices onUnauthorized={deny} />}
          <AdminWorkspace userId={session.user.id} onUnauthorized={deny} />
        </>
      )}
      {emailAccessEnabled &&
        session &&
        state !== "loading" &&
        state !== "signing-out" && (
          <section
            className="admin-card admin-account-security"
            aria-labelledby="admin-account-security-title"
          >
            <h2 id="admin-account-security-title">Seguridad de la cuenta</h2>
            <p>
              Podés cerrar tu acceso en todos los dispositivos. Necesitarás
              volver a ingresar en cada uno.
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "¿Querés cerrar tu acceso en todos los dispositivos?",
                  )
                )
                  void action(() => logout("global"));
              }}
            >
              Cerrar todas las sesiones
            </button>
          </section>
        )}
    </section>
  );
}
