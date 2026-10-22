import { useEffect, useRef, useState } from "react";
import { adminClient as client, rpc } from "./client";
import {
  accessError,
  deviceConfigurationValid,
  deviceMfaEnabled,
  deviceRpId,
  deviceSupported,
  passkeysEnabled,
} from "./access";

import { ensureCredentialFamily } from "./deviceRegistration";

type Device = {
  id: string;
  friendly_name?: string;
  kind: "login" | "verification";
  verified?: boolean;
};
export function AccessDevices({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false),
    [devices, setDevices] = useState<Device[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  if (!passkeysEnabled && !deviceMfaEnabled) return null;
  async function authorize() {
    const user = await client!.auth.getUser();
    if (user.error || !(await rpc<boolean>("is_admin", {}))) {
      onUnauthorized();
      throw new Error("denied");
    }
  }
  async function load() {
    const list: Device[] = [];
    if (passkeysEnabled) {
      const r = await client!.auth.passkey.list();
      if (r.error) throw r.error;
      list.push(...r.data.map((d) => ({ ...d, kind: "login" as const })));
    }
    if (deviceMfaEnabled) {
      const r = await client!.auth.mfa.listFactors();
      if (r.error) throw r.error;
      list.push(
        ...r.data.all
          .filter((d) => d.factor_type === "webauthn")
          .map((d) => ({
            ...d,
            kind: "verification" as const,
            verified: d.status === "verified",
          })),
      );
    }
    setDevices(list);
  }
  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await authorize();
      await run();
      await load();
    } catch (e) {
      setMessage(accessError(e));
    } finally {
      setBusy(false);
    }
  }
  async function register(kind: Device["kind"]) {
    controller.current?.abort();
    controller.current = new AbortController();
    if (
      !deviceSupported() ||
      (kind === "verification" && !deviceConfigurationValid())
    ) {
      setMessage(
        "Este dispositivo o la configuración del acceso no son compatibles. Conservá tu acceso de respaldo.",
      );
      return;
    }
    await ensureCredentialFamily(kind);
    const r =
      kind === "login"
        ? await client!.auth.registerPasskey({
            options: { signal: controller.current.signal },
          })
        : await client!.auth.mfa.webauthn.register(
            {
              friendlyName: `Dispositivo ${new Date().toLocaleDateString("es-AR")} ${crypto.randomUUID().slice(0, 6)}`,
              webauthn: {
                rpId: deviceRpId,
                rpOrigins: [location.origin],
                signal: controller.current.signal,
              },
            },
            {
              hints: ["client-device"],
              authenticatorSelection: {
                authenticatorAttachment: "platform",
                userVerification: "required",
                residentKey: "required",
              },
            },
          );
    if (r.error) throw r.error;
    setMessage(
      "Dispositivo registrado. Conservá también tu acceso de respaldo.",
    );
  }
  return (
    <section
      className="admin-card admin-access-devices"
      aria-labelledby="devices-title"
    >
      <h2 id="devices-title">Seguridad del acceso</h2>
      <p>
        Usá la protección de tu dispositivo. VANTA no recibe tu huella, tu
        rostro ni tu PIN. Una credencial puede sincronizarse entre dispositivos;
        esta lista no muestra sesiones abiertas.
      </p>
      <button
        className="button secondary"
        disabled={busy}
        aria-expanded={open}
        aria-controls="admin-devices"
        onClick={() => {
          if (open) setOpen(false);
          else {
            setOpen(true);
            void action(load);
          }
        }}
      >
        {" "}
        {open ? "Ocultar dispositivos" : "Administrar dispositivos"}{" "}
      </button>
      {open && (
        <div id="admin-devices">
          <p>
            Elegí una modalidad: ingreso con dispositivo y código de respaldo, o
            contraseña y segunda verificación con el dispositivo. No registres
            ambas en el mismo equipo. Conservá tu respaldo.
          </p>
          {!deviceSupported() && (
            <p>
              Este navegador no permite registrar un dispositivo. Conservá tu
              acceso de respaldo y probá un navegador compatible.
            </p>
          )}
          {deviceMfaEnabled && !deviceConfigurationValid() && (
            <p>
              El registro necesita completar la configuración del sitio. Tu
              acceso de respaldo sigue disponible.
            </p>
          )}
          <div className="admin-actions">
            {passkeysEnabled && deviceSupported() && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void action(() => register("login"))}
              >
                Registrar acceso con dispositivo
              </button>
            )}
            {deviceMfaEnabled &&
              deviceSupported() &&
              deviceConfigurationValid() && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void action(() => register("verification"))}
                >
                  Registrar verificación con dispositivo
                </button>
              )}
          </div>
          <ul>
            {devices.map((d) => (
              <li key={`${d.kind}-${d.id}`}>
                <span>
                  {d.friendly_name || "Dispositivo"} ·{" "}
                  {d.kind === "login"
                    ? "Ingreso"
                    : d.verified
                      ? "Segunda verificación"
                      : "Registro incompleto"}
                </span>{" "}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "¿Quitar esta credencial? Asegurate de conservar tu acceso de respaldo.",
                      )
                    )
                      return;
                    void action(async () => {
                      if (d.kind === "verification") {
                        const factors = await client!.auth.mfa.listFactors();
                        if (factors.error) throw factors.error;
                        if (
                          !factors.data.totp.some(
                            (f) => f.status === "verified",
                          )
                        ) {
                          setMessage(
                            "Conservá un autenticador de respaldo antes de quitar esta verificación.",
                          );
                          return;
                        }
                      }
                      const r =
                        d.kind === "login"
                          ? await client!.auth.passkey.delete({
                              passkeyId: d.id,
                            })
                          : await client!.auth.mfa.unenroll({ factorId: d.id });
                      if (r.error) throw r.error;
                      setMessage("Credencial eliminada.");
                    });
                  }}
                  aria-label={`Quitar ${d.friendly_name || "dispositivo"} de ${d.kind === "login" ? "ingreso" : "verificación"}`}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          {!busy && devices.length === 0 && (
            <p>No hay dispositivos registrados.</p>
          )}
        </div>
      )}
      {busy && <p role="status">Verificando…</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
