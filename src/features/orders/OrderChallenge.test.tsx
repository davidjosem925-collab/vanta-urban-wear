import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderChallenge } from "./OrderChallenge";
afterEach(() => {
  delete window.turnstile;
});
it("expiry/timeout invalidate tokens, renewed success clears errors, and removed widget callbacks cannot replace a new token", async () => {
  const options: Record<string, unknown>[] = [];
  window.turnstile = {
    render: vi.fn((_el, o) => {
      options.push(o);
      return String(options.length);
    }),
    remove: vi.fn(),
  };
  const token = vi.fn();
  const first = render(<OrderChallenge siteKey="test" onToken={token} />);
  await waitFor(() => expect(options).toHaveLength(1));
  const call = (index: number, name: string, value?: string) =>
    act(() => (options[index][name] as (v?: string) => void)(value));
  call(0, "callback", "first");
  expect(token).toHaveBeenLastCalledWith("first");
  call(0, "expired-callback");
  expect(token).toHaveBeenLastCalledWith("");
  call(0, "timeout-callback");
  expect(token).toHaveBeenLastCalledWith("");
  call(0, "error-callback");
  expect(screen.getByRole("alert")).toBeVisible();
  call(0, "callback", "renewed");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  first.unmount();
  expect(token).toHaveBeenLastCalledWith("");
  render(<OrderChallenge siteKey="test" onToken={token} />);
  await waitFor(() => expect(options).toHaveLength(2));
  call(1, "callback", "new-widget");
  token.mockClear();
  call(0, "callback", "obsolete");
  call(0, "expired-callback");
  call(0, "error-callback");
  expect(token).not.toHaveBeenCalled();
  expect(window.turnstile.remove).toHaveBeenCalledWith("1");
});
