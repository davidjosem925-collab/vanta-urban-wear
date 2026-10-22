import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDemoOrder } from "./useDemoOrder";
import {
  newAttempt,
  readAttempt,
  receipt,
  validPayload,
  type OrderPayload,
  type Receipt,
  type OrderService,
} from "./service";
const id = "10000000-0000-0000-0000-000000000001";
const p: OrderPayload = {
  items: [{ variant_id: id, quantity: 2, expected_price_cents: 2500050 }],
  delivery: "pickup",
  payment: "cash",
};
const r: Receipt = {
  reference: id,
  status: "pending",
  subtotal_cents: 5000100,
  created_at: "2026-10-20T00:00:00Z",
  expires_at: "2026-10-20T01:00:00Z",
  demo: true,
};
beforeEach(() => sessionStorage.clear());
it("validates stored attempts and server receipts; no buyer information is persisted", () => {
  expect(validPayload(p)).toBe(true);
  expect(validPayload({ ...p, items: [...p.items, ...p.items] })).toBe(false);
  expect(readAttempt("broken")).toBeNull();
  expect(readAttempt('{"key":"spoof"}')).toBeNull();
  const a = newAttempt(p);
  expect(readAttempt(JSON.stringify(a))).toEqual(a);
  expect(a.capability).toHaveLength(64);
  expect(JSON.stringify(a)).not.toMatch(/email|phone|name|address/);
  expect(receipt(r)).toEqual(r);
  for (const bad of [
    { ...r, reference: "DEMO-123" },
    { ...r, demo: false },
    { ...r, subtotal_cents: 1.1 },
    { ...r, expires_at: r.created_at },
  ])
    expect(() => receipt(bad)).toThrow();
});
it("shows loading, prevents simultaneous requests and only succeeds after genuine receipt", async () => {
  let resolve!: (v: Receipt) => void;
  const confirm = vi.fn(() => new Promise<Receipt>((r) => (resolve = r))),
    success = vi.fn();
  const s: OrderService = {
    enabled: true,
    siteKey: "test",
    recover: vi.fn().mockResolvedValue(r),
    confirm,
  };
  const hook = renderHook(() => useDemoOrder(s, success));
  let first!: Promise<void>;
  act(() => {
    first = hook.result.current.confirm(p, "token");
  });
  expect(hook.result.current.pending).toBe(true);
  expect(success).not.toHaveBeenCalled();
  await act(async () => {
    await hook.result.current.confirm(p, "other");
  });
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(r);
    await first;
  });
  expect(success).toHaveBeenCalledWith(
    r,
    p,
    expect.objectContaining({ payload: p }),
  );
  expect(hook.result.current.pending).toBe(false);
  expect(sessionStorage.length).toBe(0);
});
it("network failure keeps same attempt through retry and remount, without false success", async () => {
  const confirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("UNAVAILABLE"))
      .mockResolvedValue(r),
    success = vi.fn();
  const s: OrderService = {
    enabled: true,
    siteKey: "test",
    recover: vi.fn().mockResolvedValue(r),
    confirm,
  };
  const first = renderHook(() => useDemoOrder(s, success));
  await act(() => first.result.current.confirm(p, "token"));
  expect(first.result.current.error).toMatch(/carrito permanece intacto/);
  expect(success).not.toHaveBeenCalled();
  const a = confirm.mock.calls[0][0];
  first.unmount();
  const next = renderHook(() => useDemoOrder(s, success));
  await act(() => next.result.current.recover());
  expect(s.recover).toHaveBeenCalledWith(a);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(success).toHaveBeenCalledOnce();
});
it("stock/price failures do not clear cart or show receipt; next review gets a new key", async () => {
  for (const code of [
    "INSUFFICIENT_STOCK",
    "PRICE_CHANGED",
    "PRODUCT_UNAVAILABLE",
  ]) {
    const confirm = vi
        .fn()
        .mockRejectedValueOnce(new Error(code))
        .mockResolvedValue(r),
      success = vi.fn();
    const hook = renderHook(() =>
      useDemoOrder(
        {
          enabled: true,
          siteKey: "test",
          recover: vi.fn().mockResolvedValue(r),
          confirm,
        },
        success,
      ),
    );
    await act(() => hook.result.current.confirm(p, "token"));
    expect(success).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
    await act(() => hook.result.current.confirm(p, "new-token"));
    expect(confirm.mock.calls[0][0].key).not.toBe(confirm.mock.calls[1][0].key);
    hook.unmount();
  }
});
it("malformed success response never becomes completed and expired replay is explicit", async () => {
  const success = vi.fn(),
    confirm = vi
      .fn()
      .mockResolvedValueOnce({ ...r, demo: false })
      .mockResolvedValueOnce({ ...r, status: "expired" });
  const hook = renderHook(() =>
    useDemoOrder(
      {
        enabled: true,
        siteKey: "test",
        recover: vi.fn().mockResolvedValue(r),
        confirm,
      },
      success,
    ),
  );
  await act(() => hook.result.current.confirm(p, "token"));
  await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  expect(success).not.toHaveBeenCalled();
  await act(() => hook.result.current.confirm(p, "fresh-token"));
  expect(hook.result.current.error).toMatch(/venció/);
  expect(success).not.toHaveBeenCalled();
});
it("recovers a pending attempt even after reload with an empty or unavailable cart", async () => {
  const a = newAttempt(p);
  sessionStorage.setItem("vanta.order-attempt.v1", JSON.stringify(a));
  const success = vi.fn(),
    confirm = vi.fn(),
    recover = vi.fn().mockResolvedValue(r);
  const hook = renderHook(() =>
    useDemoOrder({ enabled: true, siteKey: "test", recover, confirm }, success),
  );
  expect(hook.result.current.recoverable).toBe(true);
  await act(() => hook.result.current.recover());
  expect(recover).toHaveBeenCalledWith(a);
  expect(confirm).not.toHaveBeenCalled();
  expect(success).toHaveBeenCalledWith(
    r,
    p,
    expect.objectContaining({ payload: p }),
  );
  expect(hook.result.current.recoverable).toBe(false);
});
it("corrupt persisted attempts fail closed instead of silently creating a fresh order", async () => {
  sessionStorage.setItem("vanta.order-attempt.v1", "broken");
  const confirm = vi.fn(),
    success = vi.fn();
  const hook = renderHook(() =>
    useDemoOrder(
      {
        enabled: true,
        siteKey: "test",
        recover: vi.fn().mockResolvedValue(r),
        confirm,
      },
      success,
    ),
  );
  await act(() => hook.result.current.confirm(p, "token"));
  expect(confirm).not.toHaveBeenCalled();
  expect(hook.result.current.error).toMatch(/almacenamiento/);
  expect(sessionStorage.getItem("vanta.order-attempt.v1")).toBe("broken");
});
it("missing recovery returns to verification while preserving identity for a late commit", async () => {
  const a = newAttempt(p);
  sessionStorage.setItem("vanta.order-attempt.v1", JSON.stringify(a));
  const success = vi.fn(),
    confirm = vi.fn().mockResolvedValue(r),
    recover = vi.fn().mockResolvedValue(null);
  const hook = renderHook(() =>
    useDemoOrder({ enabled: true, siteKey: "test", confirm, recover }, success),
  );
  await act(() => hook.result.current.recover());
  expect(recover).toHaveBeenCalledWith(a);
  expect(confirm).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
  expect(hook.result.current.recoverable).toBe(false);
  expect(hook.result.current.notice).toMatch(/Volvé a la revisión/);
  expect(readAttempt(sessionStorage.getItem("vanta.order-attempt.v1"))).toEqual(
    a,
  );
  await act(() => hook.result.current.confirm(p, "fresh-token"));
  expect(confirm).toHaveBeenCalledWith(a, "fresh-token");
  expect(success).toHaveBeenCalledOnce();
});
it("missing token makes no request or stored attempt; consumed token keeps same key for a fresh token", async () => {
  const success = vi.fn(),
    recover = vi.fn(),
    confirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("CHALLENGE_EXPIRED"))
      .mockResolvedValue(r);
  const hook = renderHook(() =>
    useDemoOrder({ enabled: true, siteKey: "test", confirm, recover }, success),
  );
  await act(() => hook.result.current.confirm(p, ""));
  expect(confirm).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
  expect(hook.result.current.error).toMatch(/verificación/);
  await act(() => hook.result.current.confirm(p, "consumed"));
  expect(hook.result.current.recoverable).toBe(false);
  expect(success).not.toHaveBeenCalled();
  const a = confirm.mock.calls[0][0];
  await act(() => hook.result.current.confirm(p, "fresh"));
  expect(confirm.mock.calls[1][0]).toEqual(a);
  expect(success).toHaveBeenCalledOnce();
});
it("older Edge rejecting recovery cannot erase an uncertain attempt", async () => {
  const a = newAttempt(p);
  sessionStorage.setItem("vanta.order-attempt.v1", JSON.stringify(a));
  const recover = vi.fn().mockRejectedValue(new Error("INVALID_REQUEST")),
    confirm = vi.fn(),
    success = vi.fn();
  const hook = renderHook(() =>
    useDemoOrder({ enabled: true, siteKey: "test", confirm, recover }, success),
  );
  await act(() => hook.result.current.recover());
  expect(readAttempt(sessionStorage.getItem("vanta.order-attempt.v1"))).toEqual(
    a,
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
});

it("payment handoff storage failure keeps the original attempt and enables recovery without another creation", async () => {
  const success = vi.fn().mockImplementationOnce(() => {
    throw Error("STORAGE");
  });
  const confirm = vi.fn().mockResolvedValue(r),
    recover = vi.fn().mockResolvedValue(r);
  const hook = renderHook(() =>
    useDemoOrder({ enabled: true, siteKey: "test", confirm, recover }, success),
  );
  await act(() => hook.result.current.confirm(p, "token"));
  const attempt = confirm.mock.calls[0][0];
  expect(readAttempt(sessionStorage.getItem("vanta.order-attempt.v1"))).toEqual(
    attempt,
  );
  expect(hook.result.current.recoverable).toBe(true);
  await act(() => hook.result.current.recover());
  expect(recover).toHaveBeenCalledWith(attempt);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem("vanta.order-attempt.v1")).toBeNull();
});
