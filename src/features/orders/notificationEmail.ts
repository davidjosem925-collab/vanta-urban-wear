/** Public input validation only; authorization and recipient allowlist live on the server. */
export function normalizeNotificationEmail(raw: string): string {
  const value = raw.trim().toLowerCase(),
    parts = value.split("@");
  if (
    value.length > 254 ||
    /[^\x21-\x7e]/.test(value) ||
    parts.length !== 2 ||
    !parts[0].length ||
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
    throw Error("INVALID_EMAIL");
  return value;
}
