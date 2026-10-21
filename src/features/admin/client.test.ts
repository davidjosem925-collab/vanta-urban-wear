import { expect, it, vi } from "vitest";
vi.mock("../../lib/supabase/config", () => ({
  readPublicSupabaseConfig: () => null,
}));
import { AdminError, safeError } from "./client";
it("distinguishes definite validation rollbacks from uncertain writes", () => {
  for (const e of [
    { code: "23514" },
    { code: "22P02" },
    { code: "22003" },
    { code: "P0001", message: "INVALID_REQUEST" },
  ]) {
    const result = safeError(e);
    expect(result).toBeInstanceOf(AdminError);
    expect((result as AdminError).kind).toBe("validation");
  }
  expect((safeError({ message: "INVALID_REQUEST" }) as AdminError).kind).toBe(
    "unknown",
  );
  expect((safeError({ message: "Failed to fetch" }) as AdminError).kind).toBe(
    "unknown",
  );
});
it("preserves unique and optimistic conflict categories without weakening authorization", () => {
  expect((safeError({ code: "23505" }) as AdminError).kind).toBe("duplicate");
  expect((safeError({ message: "EDIT_CONFLICT" }) as AdminError).kind).toBe(
    "conflict",
  );
  expect(safeError({ message: "FORBIDDEN" }).message).toContain(
    "Acceso no autorizado",
  );
  expect(safeError({ message: "INVALID_STOCK_ADJUSTMENT" }).message).toContain(
    "inferior a lo reservado",
  );
});
it("never echoes unknown response bodies or credentials into visible errors", () => {
  const err = safeError({
    message: "private-fixture-value",
    details: "private-fixture-details",
  });
  expect(err.message).not.toMatch(/private-fixture/);
});
