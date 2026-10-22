import { PaymentError, testOrder } from "./core.ts";
/** Official Orders SDK 3.6.1 canonical manifest (raw data.id, no lowercasing); WebCrypto performs constant-time MAC verification. */
export async function verifySignature(
  request: Request,
  secret: string,
  now = Date.now(),
) {
  const url = new URL(request.url);
  if (
    url.searchParams.getAll("data.id").length !== 1 ||
    url.searchParams.getAll("type").length !== 1 ||
    url.searchParams.get("type") !== "order"
  )
    throw new PaymentError("INVALID_SIGNATURE", 401);
  const id = url.searchParams.get("data.id")!;
  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  if (
    !testOrder.test(id) ||
    !/^[A-Za-z0-9-]{1,120}$/.test(requestId) ||
    signature.length > 300
  )
    throw new PaymentError("INVALID_SIGNATURE", 401);
  const parts = signature.split(",").map((s) => s.trim());
  const ts = parts.find((v) => v.startsWith("ts="))?.slice(3),
    v1 = parts.find((v) => v.startsWith("v1="))?.slice(3);
  if (
    parts.length !== 2 ||
    !ts ||
    !/^\d{10}(?:\d{3})?$/.test(ts) ||
    !v1 ||
    !/^[a-f0-9]{64}$/.test(v1)
  )
    throw new PaymentError("INVALID_SIGNATURE", 401);
  const time = Number(ts) * (ts.length === 10 ? 1000 : 1);
  // Allow old signed retries; dedup + current API lookup prevent replayed state changes.
  if (time > now + 300000) throw new PaymentError("INVALID_SIGNATURE", 401);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const mac = Uint8Array.from(v1.match(/../g)!, (v) => parseInt(v, 16));
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      mac,
      new TextEncoder().encode(manifest),
    ))
  )
    throw new PaymentError("INVALID_SIGNATURE", 401);
  return { id, manifest };
}
