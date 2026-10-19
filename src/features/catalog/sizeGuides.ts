export type SizeTable = {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
};
type Guide = {
  name: string;
  note: string;
  tables: SizeTable[];
  instructions: string[];
};
const sizes = ["S", "M", "L", "XL"];
const chest =
  "Ancho de pecho: con la prenda extendida y sin estirar, medí de costura a costura justo debajo de las sisas. Es un ancho, no un contorno corporal.";
const upperLength =
  "Largo superior: medí desde el punto más alto del hombro, junto al cuello, hasta el ruedo.";
const sleeve =
  "Manga: medí desde la costura del hombro hasta el puño por el borde exterior. El hombro caído puede variar esta referencia.";
const waist =
  "Cintura: medí el ancho de la cintura con la prenda extendida y sin estirar y multiplicalo por dos para obtener el contorno.";
const hip =
  "Cadera: medí el ancho de la parte más amplia de la prenda, debajo de la cintura, y multiplicalo por dos para obtener el contorno.";
const lowerLength =
  "Largo inferior: medí por el costado, desde el borde superior de la cintura hasta el ruedo.";
const tee: SizeTable = {
  caption: "Remeras · corte amplio / oversize",
  columns: ["Talle", "Ancho de pecho", "Largo"],
  rows: sizes.map((size, i) => [size, 56 + i * 2, 70 + i * 2]),
};
const upper: SizeTable = {
  caption: "Buzos · silueta amplia",
  columns: ["Talle", "Ancho de pecho", "Largo", "Manga"],
  rows: sizes.map((size, i) => [size, 60 + i * 2, 70 + i * 2, 60 + i]),
};
const lower: SizeTable = {
  caption: "Pantalones · corte relaxed",
  columns: ["Talle", "Cintura (contorno)", "Cadera (contorno)", "Largo"],
  rows: sizes.map((size, i) => [size, 76 + i * 4, 110 + i * 4, 100 + i * 2]),
};
export const sizeGuides: Record<string, Guide> = {
  remeras: {
    name: "Remeras",
    note: "Referencia de corte amplio / oversize, con holgura en el pecho. Las proporciones pueden variar según el modelo.",
    tables: [tee],
    instructions: [chest, upperLength],
  },
  buzos: {
    name: "Buzos",
    note: "Referencia de silueta amplia, con espacio para usar otra capa debajo.",
    tables: [upper],
    instructions: [chest, upperLength, sleeve],
  },
  pantalones: {
    name: "Pantalones",
    note: "Referencia de corte relaxed: cadera y pierna holgadas. No representa el estiramiento máximo de una cintura elástica.",
    tables: [lower],
    instructions: [waist, hip, lowerLength],
  },
  conjuntos: {
    name: "Conjuntos",
    note: "Referencia de conjunto con parte superior amplia y pantalón relaxed. Compará ambas partes con prendas que te resulten cómodas.",
    tables: [
      { ...upper, caption: "Parte superior · silueta amplia" },
      { ...lower, caption: "Parte inferior · corte relaxed" },
    ],
    instructions: [chest, upperLength, sleeve, waist, hip, lowerLength],
  },
};
