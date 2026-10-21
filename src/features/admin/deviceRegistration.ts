import { adminClient as client } from "./client";
// The server uses the same RP/user handle for primary and MFA credentials but
// keeps separate credential stores. Some platform authenticators replace the
// resident credential when registering the other family. Fail closed on mixing.
export async function ensureCredentialFamily(kind: "login" | "verification") {
  let conflict = false;
  if (kind === "login") {
    const r = await client!.auth.mfa.listFactors();
    if (r.error) throw r.error;
    conflict = r.data.all.some(
      (f) => f.factor_type === "webauthn" && f.status === "verified",
    );
  } else {
    const r = await client!.auth.passkey.list();
    if (r.error) throw r.error;
    conflict = Boolean(r.data?.length);
  }
  if (conflict)
    throw Object.assign(new Error("credential family conflict"), {
      code: "device_credential_conflict",
    });
}
