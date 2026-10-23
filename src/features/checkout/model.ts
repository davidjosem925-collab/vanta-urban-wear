/** Presentation-only draft. Never a payment payload or a commercial order. */
export type Delivery = "shipping" | "pickup";
export type DemoPayment = "" | "mercado_pago" | "transfer" | "cash";
export type CheckoutDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  delivery: Delivery;
  province: string;
  city: string;
  postalCode: string;
  street: string;
  streetNumber: string;
  apartment: string;
  instructions: string;
  payment: DemoPayment;
};
export type Field = keyof CheckoutDraft;
export type Errors = Partial<Record<Field, string>>;
export const initialDraft: CheckoutDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  delivery: "shipping",
  province: "",
  city: "",
  postalCode: "",
  street: "",
  streetNumber: "",
  apartment: "",
  instructions: "",
  payment: "",
};
export const provinces = [
  "Ciudad Autónoma de Buenos Aires",
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
];
export const paymentNames: Record<DemoPayment, string> = {
  "": "Por elegir",
  mercado_pago: "Mercado Pago",
  transfer: "Transferencia bancaria",
  cash: "Efectivo",
};
export const shippingNotice =
  "Envío a coordinar. El costo de envío no está incluido en el subtotal.";
export function changeDelivery(
  draft: CheckoutDraft,
  delivery: Delivery,
): CheckoutDraft {
  return {
    ...draft,
    delivery,
    payment:
      delivery === "shipping" && draft.payment === "cash" ? "" : draft.payment,
  };
}
function text(value: string, min: number, max: number) {
  const v = value.trim();
  return (
    v.length >= min &&
    v.length <= max &&
    ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
export function validateDraft(d: CheckoutDraft): Errors {
  const e: Errors = {};
  if (!text(d.firstName, 2, 60))
    e.firstName = "Ingresá tu nombre (entre 2 y 60 caracteres).";
  if (!text(d.lastName, 2, 60))
    e.lastName = "Ingresá tu apellido (entre 2 y 60 caracteres).";
  if (
    !text(d.email, 5, 254) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())
  )
    e.email = "Ingresá un correo válido, por ejemplo nombre@ejemplo.com.";
  const digits = d.phone.replace(/\D/g, "");
  if (
    !text(d.phone, 8, 40) ||
    !/^\+?[\d\s().-]+$/.test(d.phone.trim()) ||
    digits.length < 8 ||
    digits.length > 15
  )
    e.phone =
      "Ingresá un teléfono válido, con código de área (8 a 15 dígitos).";
  if (d.delivery !== "shipping" && d.delivery !== "pickup")
    e.delivery = "Elegí una modalidad de entrega.";
  if (d.delivery === "shipping") {
    if (!provinces.includes(d.province)) e.province = "Elegí una provincia.";
    if (!text(d.city, 2, 80))
      e.city = "Ingresá la localidad (entre 2 y 80 caracteres).";
    if (!/^(\d{4}|[a-z]\d{4}[a-z]{3})$/i.test(d.postalCode.trim()))
      e.postalCode =
        "Ingresá un código postal argentino de 4 dígitos o un CPA, como C1000AAA.";
    if (!text(d.street, 2, 100))
      e.street = "Ingresá la calle (entre 2 y 100 caracteres).";
    if (!/^([1-9]\d{0,5}[a-z]?|s\/?n)$/i.test(d.streetNumber.trim()))
      e.streetNumber = "Ingresá la altura o S/N si no tiene número.";
    if (!text(d.apartment, 0, 40))
      e.apartment = "Usá hasta 40 caracteres para piso/departamento.";
    if (d.instructions.length > 300)
      e.instructions = "Usá hasta 300 caracteres para las indicaciones.";
  }
  if (
    !Object.hasOwn(paymentNames, d.payment) ||
    !d.payment ||
    (d.payment === "cash" && d.delivery !== "pickup")
  )
    e.payment = "Elegí un método de pago compatible con la entrega.";
  return e;
}
