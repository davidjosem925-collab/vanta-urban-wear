/** Server-only contact handling. No email address or key may enter diagnostics/storage logs. */
export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 254 || /[^\x21-\x7e]/.test(raw))
    throw new Error("INVALID_EMAIL");
  const value = raw.toLowerCase();
  const parts = value.split("@");
  if (
    parts.length !== 2 ||
    parts[0].length < 1 ||
    parts[0].length > 64 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) ||
    parts[0].startsWith(".") ||
    parts[0].endsWith(".") ||
    parts[0].includes("..") ||
    parts[1].length > 253 ||
    !parts[1].includes(".") ||
    parts[1]
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error("INVALID_EMAIL");
  return value;
}
export function recipients(raw: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 20)
      throw Error();
    return new Set(parsed.map(normalizeEmail));
  } catch {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
}
function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function bytes(value: string) {
  if (value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error();
  const result = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (base64(result) !== value) throw Error();
  return result;
}
export async function encryptionKey(value: string): Promise<CryptoKey> {
  try {
    const raw = bytes(value);
    if (raw.length !== 32) throw Error();
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  } catch {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
}
export async function seal(
  value: string,
  key: CryptoKey,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(value),
  );
  // Avoid a spread of large ciphertext buffers, which can exceed the JS argument limit.
  let text = "";
  for (const byte of new Uint8Array(data)) text += String.fromCharCode(byte);
  return `v1.${base64(iv)}.${btoa(text)}`;
}
export async function unseal(
  value: unknown,
  key: CryptoKey,
  context: string,
): Promise<string> {
  try {
    if (typeof value !== "string" || value.length > 200000) throw Error();
    const [version, rawIv, rawCipher, extra] = value.split(".");
    if (version !== "v1" || extra !== undefined) throw Error();
    const iv = bytes(rawIv),
      data = bytes(rawCipher);
    if (iv.length !== 12 || data.length < 16) throw Error();
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(context),
      },
      key,
      data,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch {
    throw new Error("KEY_UNAVAILABLE");
  }
}
export type EmailEnrollment = { recipient_hash: string; ciphertext: string };
export async function enrollEmail(
  raw: unknown,
  contextKey: string,
  settings: { enabled: boolean; allowed: string; encryption: string },
): Promise<EmailEnrollment> {
  if (!settings.enabled) throw new Error("EMAIL_DISABLED");
  const email = normalizeEmail(raw);
  if (!recipients(settings.allowed).has(email))
    throw new Error("EMAIL_RECIPIENT_UNAVAILABLE");
  const key = await encryptionKey(settings.encryption);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)),
  );
  return {
    recipient_hash: [...digest]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join(""),
    ciphertext: await seal(email, key, `vanta-email-contact:${contextKey}`),
  };
}
