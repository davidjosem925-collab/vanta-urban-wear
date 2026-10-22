// @vitest-environment node
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { it, expect } from "vitest";
it("source module names resolve unambiguously on case-insensitive Windows filesystems", () => {
  const seen = new Map<string, string>();
  const collisions: string[][] = [];
  function visit(dir: string) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) visit(path);
      else if (/\.(ts|tsx)$/.test(item.name)) {
        // Extensionless resolution checks .ts before .tsx; casing cannot disambiguate them on Windows.
        const key = relative("src", path)
          .replace(/\.(ts|tsx)$/, "")
          .toLowerCase();
        const prior = seen.get(key);
        if (prior) collisions.push([prior, path]);
        else seen.set(key, path);
      }
    }
  }
  visit("src");
  expect(collisions).toEqual([]);
});
