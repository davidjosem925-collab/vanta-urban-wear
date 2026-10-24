/** Public, side-effect-free destination policy shared by Edge and storefront.
 * pref_id is an opaque provider routing token, never proof of identity/payment.
 * Raw grammar rejects URL-parser normalization, encoded names and extra fields.
 */
export function validCheckoutUrl(
  raw: unknown,
  expectedOrder?: string,
): raw is string {
  if (typeof raw !== "string") return false;
  const match =
    /^https:\/\/www\.mercadopago\.com\.ar\/checkout\/v1\/redirect\?(order_id=ORDTST[A-Z0-9]{10,60}(?:&pref_id=[A-Za-z0-9_-]{1,200})?|pref_id=[A-Za-z0-9_-]{1,200}&order_id=ORDTST[A-Z0-9]{10,60})$/.exec(
      raw,
    );
  // JS $ also matches before a final newline: require the entire original string.
  if (!match || match[0] !== raw) return false;
  const order = new URL(raw).searchParams.get("order_id");
  return expectedOrder === undefined || order === expectedOrder;
}
