import { beforeEach, expect, it, vi } from "vitest";
import type { PaymentSession } from "../payments/service";
const { getSession, requestPayment } = vi.hoisted(() => ({
  getSession: vi.fn(), requestPayment: vi.fn(),
}));
vi.mock("./client", () => ({ connected: () => ({ auth: { getSession } }) }));
vi.mock("../payments/service", () => ({ requestPayment }));
vi.mock("../../lib/supabase/config", () => ({
  readPublicSupabaseConfig: () => ({ url: "https://project.supabase.co", key: "public-key" }),
}));
import { requestAdminPayment } from "./paymentService";
const session = { reference: "original-order" } as PaymentSession;
beforeEach(() => { vi.clearAllMocks(); });
it("uses the admin auth namespace and supplies the JWT without private keys", async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: "admin-jwt" } }, error: null });
  requestPayment.mockResolvedValue(null);
  await requestAdminPayment(session, "recover");
  expect(requestPayment).toHaveBeenCalledWith(
    { url: "https://project.supabase.co", key: "public-key" }, session, "recover", fetch, "admin-jwt",
  );
});
it("refuses to send a payment request without an admin session", async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null });
  await expect(requestAdminPayment(session, "create")).rejects.toThrow("FORBIDDEN");
  expect(requestPayment).not.toHaveBeenCalled();
});
