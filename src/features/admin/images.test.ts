import { it, expect } from "vitest";
import { validImageHeader } from "./images";
it("rejects spoofed image MIME/SVG and validates actual file signatures", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  expect(
    validImageHeader(
      "image/png",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
  ).toBe(true);
  expect(
    validImageHeader("image/jpeg", new Uint8Array([255, 216, 255, 224])),
  ).toBe(true);
  expect(validImageHeader("image/webp", bytes("RIFF0000WEBP"))).toBe(true);
  expect(validImageHeader("image/avif", bytes("0000ftypavif"))).toBe(true);
  for (const type of [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/avif",
    "image/svg+xml",
  ])
    expect(
      validImageHeader(type, bytes("<svg><script>alert(1)</script></svg>")),
    ).toBe(false);
});
