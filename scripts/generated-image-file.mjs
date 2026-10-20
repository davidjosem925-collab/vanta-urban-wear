import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

// Only CRLF is equivalent to LF. Whitespace, BOMs and content remain significant.
const lf = (text) => text.replaceAll("\r\n", "\n");
export const sameGeneratedText = (actual, expected) => lf(actual) === lf(expected);

/** Validate without writing; preparation preserves identical bytes and mtimes. */
export async function generatedImageFile(target, expected, { check = false, text = false } = {}) {
  let actual;
  try {
    actual = await readFile(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const matches = actual !== undefined && (text
    ? sameGeneratedText(actual.toString("utf8"), expected)
    : actual.equals(expected));
  if (matches) return;
  if (check)
    throw new Error(`${basename(target)}: ${actual === undefined ? "archivo generado ausente" : "contenido generado desactualizado o alterado"}. Ejecutar images:prepare offline y revisar el diff.`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text ? lf(expected) : expected);
}
