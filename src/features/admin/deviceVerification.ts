import { adminClient as client } from "./client";
// Use the SDK's challenge method to strengthen verification without replacing
// the server-issued challenge (authenticate's override type requires a challenge).
export async function verifyDevice(
  params: {
    factorId: string;
    webauthn: { rpId: string; rpOrigins: string[]; signal?: AbortSignal };
  },
  request: { userVerification: "required" },
) {
  const r = await client!.auth.mfa.webauthn.challenge(
    { ...params, signal: params.webauthn.signal },
    { request: { ...request, hints: ["client-device"] } },
  );
  if (r.error || !r.data)
    return { data: null, error: r.error ?? new Error("verification failed") };
  return client!.auth.mfa.webauthn.verify({
    factorId: params.factorId,
    challengeId: r.data.challengeId,
    webauthn: { ...params.webauthn, ...r.data.webauthn },
  });
}
