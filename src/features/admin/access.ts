// Public build-time switches, never authorization. SQL remains the authority.
export const passkeysEnabled =
  import.meta.env.VITE_ADMIN_PASSKEYS_ENABLED === "true";
export const deviceMfaEnabled =
  import.meta.env.VITE_ADMIN_DEVICE_MFA_ENABLED === "true";
export const deviceRpId = import.meta.env.VITE_ADMIN_RP_ID?.trim() ?? "";
export function deviceSupported(): boolean {
  return (
    window.isSecureContext &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.get === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}
export function deviceConfigurationValid(): boolean {
  return Boolean(
    deviceRpId &&
      !/[/:\s]/.test(deviceRpId) &&
      (location.hostname === deviceRpId ||
        location.hostname.endsWith(`.${deviceRpId}`)),
  );
}
export function accessError(error: unknown): string {
  const e = error as {
    code?: string;
    name?: string;
    cause?: { name?: string };
  };
  if (e?.code === "device_credential_conflict")
    return "Ya tenés otra modalidad de dispositivo registrada. Para cambiarla, comprobá tu contraseña y código de respaldo y quitá primero esas credenciales. Así evitamos reemplazar un acceso que todavía usás.";
  if (e?.code === "webauthn_verification_failed")
    return "No pudimos validar esta credencial. Elegí la correspondiente o usá tu acceso de respaldo.";
  if (
    [e?.name, e?.cause?.name].some(
      (n) => n === "NotAllowedError" || n === "AbortError",
    ) ||
    e?.code === "ERROR_CEREMONY_ABORTED"
  )
    return "La verificación se canceló o no se completó a tiempo. Podés volver a intentar o usar tu contraseña y código de respaldo.";
  if (
    e?.code === "passkey_disabled" ||
    e?.code === "mfa_webauthn_enroll_not_enabled" ||
    e?.code === "mfa_webauthn_verify_not_enabled"
  )
    return "El acceso con el dispositivo todavía no está habilitado. Usá tu acceso de respaldo.";
  if (
    e?.code === "webauthn_challenge_expired" ||
    e?.code === "webauthn_challenge_not_found"
  )
    return "La verificación venció. Volvé a iniciarla.";
  return "No pudimos completar la autenticación. Revisá los datos o intentá más tarde.";
}
