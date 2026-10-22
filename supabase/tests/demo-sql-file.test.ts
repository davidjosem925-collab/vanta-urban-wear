// @vitest-environment node
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  buildDemoSql,
  prepareDemoSqlFile,
} from "../../scripts/prepare-demo-catalog.mjs";
import { selectCatalog } from "../../scripts/demo-catalog.mjs";
const folders: string[] = [];
function file() {
  const dir = mkdtempSync(join(tmpdir(), "vanta-sql-eol-"));
  folders.push(dir);
  return join(dir, "seed.sql");
}
afterEach(() => {
  for (const dir of folders.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it.each(["all", "extension"])(
  "checks and prepares %s SQL with CRLF without changing bytes or mtime",
  (scope) => {
    const sql = buildDemoSql(selectCatalog(scope));
    const path = file();
    const crlf = sql.replaceAll("\n", "\r\n");
    writeFileSync(path, crlf);
    utimesSync(path, 946684800, 946684800);
    const before = statSync(path).mtimeMs;
    prepareDemoSqlFile(path, sql, true);
    prepareDemoSqlFile(path, sql);
    expect(readFileSync(path, "utf8")).toBe(crlf);
    expect(statSync(path).mtimeMs).toBe(before);
  },
);
it.each([
  "select 2;\n",
  "\ufeffselect 1;\n",
  "select 1;",
  "select  1;\n",
  "select 1;\r",
])(
  "rejects substantive changes %j without rewriting in check mode",
  (actual) => {
    const path = file();
    writeFileSync(path, actual);
    expect(() => prepareDemoSqlFile(path, "select 1;\n", true)).toThrow(
      /SQL desactualizado/,
    );
    expect(readFileSync(path, "utf8")).toBe(actual);
  },
);
it("check never creates missing files; preparation creates only the requested local file", () => {
  const path = file();
  expect(() => prepareDemoSqlFile(path, "select 1;\n", true)).toThrow(
    /SQL desactualizado/,
  );
  expect(() => readFileSync(path)).toThrow();
  prepareDemoSqlFile(path, "select 1;\n");
  expect(readFileSync(path, "utf8")).toBe("select 1;\n");
});
