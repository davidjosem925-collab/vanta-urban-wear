/** Storefront copy only. Never mutate catalog rows, signed paths or order snapshots. */
export function productTitle(value: string): string {
  return value.replace(/\s+[—–-]\s*DEMO\s*$/i, "").trim();
}
const disclaimers = [
  "Producto y precio ficticios para revisión de VANTA. Fotografía original generada con IA; ilustrativa del modelo y no de todas las variantes de color. No constituye una oferta comercial.",
  "Producto y precio ficticios para revisión de VANTA. Fotografía original generada con IA; ilustrativa del color principal, no de todas las variantes. No constituye una oferta comercial.",
];
export function productDescription(value: string): string {
  const text = value.trim();
  const suffix = disclaimers.find((notice) => text.endsWith(notice));
  const description = suffix ? text.slice(0, -suffix.length).trim() : text;
  return description
    .replace(
      /\s*Fotografía principal en (blanco hueso|gris melange claro|beige piedra|gris claro)\.\s*$/,
      "",
    )
    .trim();
}
export function imageCaption(value: string): string {
  return productTitle(
    value
      .replace(
        /; imagen ilustrativa original generada con IA para demostración\s*$/i,
        "",
      )
      .replace(
        /; fotografía ilustrativa original generada con IA en ([^.;]+)\s*$/i,
        ", $1",
      ),
  );
}
