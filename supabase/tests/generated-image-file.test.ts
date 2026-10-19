// @vitest-environment node
import { cp, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generatedImageFile } from "../../scripts/generated-image-file.mjs";
import { OUTPUT, prepareImages } from "../../scripts/prepare-catalog-images.mjs";

const directories: string[] = [];
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), "vanta-image-eol-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Integridad multiplataforma de archivos generados", () => {
  it.each(["\n", "\r\n"])("acepta LF/CRLF (%j) sin reescribir contenido ni mtime", async (eol) => {
    const path = join(await workspace(), "manifest.json");
    const expected = '{\n  "sha256": "intacto"\n}\n';
    const actual = expected.replaceAll("\n", eol);
    await writeFile(path, actual);
    await utimes(path, 946684800, 946684800);
    const before = await stat(path);
    await generatedImageFile(path, expected, { check: true, text: true });
    await generatedImageFile(path, expected, { text: true });
    expect(await readFile(path, "utf8")).toBe(actual);
    expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  });

  it.each([
    '{\n "sha256": "alterado"\n}\n',
    '{\n "sha256": "intacto"\n}',
    '\ufeff{\n "sha256": "intacto"\n}\n',
    '{\n  "sha256": "intacto"\n}\n',
    '{\r "sha256": "intacto"\r}\r',
  ])("rechaza cambios reales sin escribir: %j", async (actual) => {
    const path = join(await workspace(), "manifest.json");
    await writeFile(path, actual);
    await expect(generatedImageFile(path, '{\n "sha256": "intacto"\n}\n', { check: true, text: true }))
      .rejects.toThrow(/manifest.json.*alterado/);
    expect(await readFile(path, "utf8")).toBe(actual);
  });

  it("preserva binarios idénticos y rechaza cualquier cambio, incluso CRLF", async () => {
    const path = join(await workspace(), "front.webp");
    const expected = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x0d, 0x0a, 0x00]);
    await writeFile(path, expected);
    await utimes(path, 946684800, 946684800);
    await generatedImageFile(path, expected);
    expect((await stat(path)).mtimeMs).toBe(946684800000);
    const changed = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x0a, 0x00]);
    await writeFile(path, changed);
    await expect(generatedImageFile(path, expected, { check: true })).rejects.toThrow(/front.webp.*alterado/);
    expect(await readFile(path)).toEqual(changed);
  });

  it("informa archivos faltantes y solo prepara cuando se solicita", async () => {
    const path = join(await workspace(), "new.sql");
    await expect(generatedImageFile(path, "select 1;\n", { check: true, text: true })).rejects.toThrow(/new.sql.*ausente/);
    await expect(stat(path)).rejects.toThrow();
    await generatedImageFile(path, "select 1;\r\n", { text: true });
    expect(await readFile(path, "utf8")).toBe("select 1;\n");
  });

  it("verifica las 36 imágenes reales con manifiesto/SQL CRLF y prepara sin cambios", async () => {
    const directory = await workspace();
    await cp(OUTPUT, directory, { recursive: true });
    const names = ["manifest.json", "link-images.pending.sql"];
    for (const name of names) {
      const path = join(directory, name);
      await writeFile(path, (await readFile(path, "utf8")).replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"));
    }
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    const paths = [...names, ...manifest.records.map((row: { storage_path: string }) => row.storage_path)];
    const before = await Promise.all(paths.map(async (name) => {
      const path = join(directory, name);
      await utimes(path, 946684800, 946684800);
      return readFile(path);
    }));
    expect(await prepareImages(true, directory)).toHaveLength(36);
    expect(await prepareImages(false, directory)).toHaveLength(36);
    for (const [index, name] of paths.entries()) {
      const path = join(directory, name);
      expect(await readFile(path)).toEqual(before[index]);
      expect((await stat(path)).mtimeMs).toBe(946684800000);
    }
  }, 120000);
});
