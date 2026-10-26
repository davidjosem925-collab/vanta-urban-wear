import { connected } from "./client";
import { readPublicSupabaseConfig } from "../../lib/supabase/config";
import { requestPayment, type PaymentSession } from "../payments/service";

// Admin-only adapter. The storefront never reads the admin auth namespace.
// The original order capability is still required; admin membership is additional.
export async function requestAdminPayment(
  session: PaymentSession,
  action: "create" | "recover",
) {
  const config = readPublicSupabaseConfig(import.meta.env);
  if (!config) throw new Error("NOT_CONFIGURED");
  const { data, error } = await connected().auth.getSession();
  if (error || !data.session?.access_token) throw new Error("FORBIDDEN");
  return requestPayment(config, session, action, fetch, data.session.access_token);
}
