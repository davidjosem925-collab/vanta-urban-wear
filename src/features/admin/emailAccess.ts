import { adminClient } from "./client";

export const emailAccessEnabled =
  import.meta.env.VITE_ADMIN_EMAIL_ACCESS_ENABLED === "true";
export const linkError =
  "El enlace venció, ya se usó o no es válido. Solicitá uno nuevo.";
export type EmailCallback =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "hash"; token: string; recovery: boolean }
  | { kind: "code"; code: string; flowId?: string; recovery: boolean };

// Accept only the two fixed administrative purposes. No arbitrary redirect URLs.
export function readEmailCallback(url: URL): EmailCallback {
  const recovery = url.searchParams.get("admin_recovery") === "1";
  const email = url.searchParams.get("admin_email") === "1";
  if (!recovery && !email)
    return {
      kind:
        url.searchParams.has("token_hash") || url.searchParams.has("code")
          ? "invalid"
          : "none",
    };
  if (
    recovery === email ||
    url.searchParams.has("error") ||
    url.hash.includes("error=")
  )
    return { kind: "invalid" };
  const token = url.searchParams.get("token_hash");
  const code = url.searchParams.get("code");
  if (
    token &&
    !code &&
    token.length <= 2048 &&
    url.searchParams.get("type") === (recovery ? "recovery" : "email")
  )
    return { kind: "hash", token, recovery };
  if (code && !token && code.length <= 2048)
    return {
      kind: "code",
      code,
      recovery,
      flowId: url.searchParams.get("sb_flow_id") ?? undefined,
    };
  return { kind: "invalid" };
}
export function emailRedirect(recovery = false): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set(recovery ? "admin_recovery" : "admin_email", "1");
  url.hash = "/admin";
  return url.href;
}
export async function requestAdminLink(email: string) {
  if (!adminClient) throw new Error("unavailable");
  return adminClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: emailRedirect() },
  });
}
