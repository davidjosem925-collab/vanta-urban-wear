import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { adminClient as client, rpc } from "./client";
import { AdminWorkspace } from "./Workspace";
import "./admin.css";
import { clearAdminPreviews } from "./previews";
export function AdminPage() {
  const [session, setSession] = useState<Session | null>(null),
    [state, setState] = useState<
      "loading" | "login" | "mfa" | "ready" | "denied"
    >("loading");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [factor, setFactor] = useState(""),
    [qr, setQr] = useState(""),
    [recovery, setRecovery] = useState(false);
  const generation = useRef(0);
  const authorizedUser = useRef<string | null>(null);
  const [authRevision, setAuthRevision] = useState(0);
  const initialCallback = useRef(new URL(location.href));
  const exchange = useRef<Promise<{ error: unknown }> | null>(null);
  const deny = useCallback(() => {
    authorizedUser.current = null;
    clearAdminPreviews();
    setState("denied");
    setSession(null);
  }, []);
  const inspect = useCallback(async () => {
    const id = ++generation.current;
    if (!client) {
      setState("login");
      return;
    }
    try {
      const { data: s } = await client.auth.getSession();
      if (id !== generation.current) return;
      setSession(s.session);
      if (!s.session) {
        authorizedUser.current = null;
        clearAdminPreviews();
        setState("login");
        return;
      }
      const { error } = await client.auth.getUser();
      if (error) throw error;
      if (!(await rpc<boolean>("admin_membership", {}))) {
        if (id === generation.current) {
          authorizedUser.current = null;
          clearAdminPreviews();
          setState("denied");
        }
        return;
      }
      const { data, error: aalError } =
        await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (id !== generation.current) return;
      authorizedUser.current =
        data.currentLevel === "aal2" ? s.session.user.id : null;
      setState(data.currentLevel === "aal2" ? "ready" : "mfa");
    } catch {
      if (id !== generation.current) return;
      authorizedUser.current = null;
      clearAdminPreviews();
      setSession(null);
      setState("denied");
      setError(
        "No pudimos validar tu acceso. Cerrá la sesión y volvé a ingresar.",
      );
    }
  }, []);
  useEffect(() => {
    const counter = generation;
    let active = true;
    async function initial() {
      const url = initialCallback.current,
        code = url.searchParams.get("code");
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
            "El enlace venció o no corresponde a esta pestaña. Solicitá uno nuevo.",
          );
          setState("login");
          return;
        }
        setRecovery(true);
      }
      if (active) void inspect();
    }
    void initial().catch(() => {
      if (active) {
        setError("No se pudo recuperar la sesión. Solicitá un enlace nuevo.");
        setState("login");
      }
    });
    const sub = client?.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      generation.current++;
      setAuthRevision((v) => v + 1);
      setSession(next);
      const sameAuthorizedUser = next?.user.id === authorizedUser.current;
      if (!sameAuthorizedUser) {
        setQr("");
        setFactor("");
      }
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") {
        setState("login");
        setRecovery(false);
        authorizedUser.current = null;
        clearAdminPreviews();
      } else if (!sameAuthorizedUser || event === "PASSWORD_RECOVERY")
        setState("loading");
    });
    const focus = () => {
      if (active) void inspect();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      counter.current++;
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
    } catch {
      setError(
        "No pudimos completar la autenticación. Revisá los datos o intentá más tarde.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
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
    await client?.auth.signOut({ scope: "local" });
    setSession(null);
    setQr("");
    setFactor("");
    setRecovery(false);
    setState("login");
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
    for (const f of data.all.filter((f) => f.status === "unverified")) {
      const { error } = await client.auth.mfa.unenroll({ factorId: f.id });
      if (error) throw error;
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
            onClick={() => void action(logout)}
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
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
      {state === "loading" && <p role="status">Verificando acceso…</p>}
      {state === "denied" && (
        <div className="admin-card">
          <h2>Acceso no autorizado</h2>
          <p>
            Se requiere una cuenta administrativa activa. El registro público no
            concede permisos.
          </p>
          <button
            className="button secondary"
            onClick={() => void action(logout)}
          >
            Volver al acceso
          </button>
        </div>
      )}
      {state === "login" && (
        <div className="admin-card admin-auth">
          <h2>Ingresá a VANTA</h2>
          {!client && (
            <p role="alert">
              Configurá las variables públicas de Supabase para habilitar el
              acceso.
            </p>
          )}
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
            <button className="button primary" disabled={busy || !client}>
              Ingresar
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const email = String(new FormData(e.currentTarget).get("email"));
              void action(async () => {
                const redirect = new URL(location.pathname, location.origin);
                redirect.searchParams.set("admin_recovery", "1");
                redirect.hash = "/admin";
                await client?.auth.resetPasswordForEmail(email, {
                  redirectTo: redirect.toString(),
                });
                setNotice(
                  "Si la cuenta puede recuperar el acceso, recibirá un enlace. Abrilo en este mismo navegador.",
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
        </div>
      )}
      {state === "mfa" && (
        <div className="admin-card admin-auth">
          <h2>Verificación en dos pasos</h2>
          <p>
            Usá una aplicación autenticadora. Si no tenés un factor, configurá
            uno. Guardá su recuperación por un canal seguro.
          </p>
          {!factor ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void action(setup)}
            >
              Continuar con MFA
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
                  Verificar MFA
                </button>
              </form>
            </>
          )}
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
                setRecovery(false);
                setNotice("Contraseña actualizada.");
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
        <AdminWorkspace userId={session.user.id} onUnauthorized={deny} />
      )}
    </section>
  );
}
