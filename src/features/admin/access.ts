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
    status?: number;
  };
  if (e?.code === "invalid_credentials")
    return "El correo o la contraseña no son correctos. Revisalos y volvé a intentar.";
  if (e?.code === "admin_logout_unconfirmed")
    return "No pudimos confirmar el cierre de sesión en el servidor. Los datos quedaron ocultos. Reintentá cerrar sesión antes de dejar este dispositivo.";
  if (
    e?.code === "mfa_totp_verify_not_enabled" ||
    e?.code === "mfa_totp_enroll_not_enabled"
  )
    return "La aplicación de códigos no está habilitada para esta operación en el servicio. Pedile al responsable que revise la configuración; no borres tu autenticador.";
  if (isSessionError(error))
    return "Tu sesión venció o fue revocada. Volvé a ingresar y completá la verificación. No hace falta cambiar tu contraseña.";
  if (e?.code === "mfa_verification_failed")
    return "El código no es válido. Esperá uno nuevo, comprobá que elegiste la aplicación correcta y que la hora del celular sea automática. Podés reintentar sin cerrar sesión.";
  if (e?.code === "mfa_factor_not_found")
    return "Ese método ya no está disponible. Actualizá los métodos y elegí uno registrado. No se borró ningún método desde esta pantalla.";
  if (e?.code === "mfa_challenge_expired")
    return "La verificación venció. Ingresá un código nuevo para volver a intentarlo.";
  if (e?.code === "mfa_ip_address_mismatch")
    return "La conexión cambió durante la verificación. Reintentá manteniendo la misma red y conexión.";
  if (e?.status === 429 || e?.code === "over_request_rate_limit")
    return "Hay demasiados intentos. Esperá unos minutos antes de volver a verificar.";
  if (e?.name === "AuthRetryableFetchError" || e?.name === "TypeError")
    return "No pudimos contactar al servicio de acceso. Revisá la conexión y volvé a intentar. Un fallo de red no requiere cambiar tu contraseña.";
  if (e?.code === "insufficient_aal")
    return "Necesitás completar la segunda verificación antes de realizar esta acción.";
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
  if (typeof e?.status === "number" && e.status >= 400 && e.status <= 599)
    return `El servicio rechazó la solicitud de acceso (HTTP ${e.status}). Volvé a intentar o consultá al responsable de configuración.`;
  return "No pudimos completar la autenticación. Revisá los datos o intentá más tarde.";
}

export function isSessionError(error: unknown): boolean {
  const e = error as { code?: string; name?: string };
  return (
    e?.name === "AuthSessionMissingError" ||
    [
      "session_not_found",
      "session_expired",
      "refresh_token_not_found",
      "refresh_token_already_used",
      "bad_jwt",
    ].includes(e?.code ?? "")
  );
}
