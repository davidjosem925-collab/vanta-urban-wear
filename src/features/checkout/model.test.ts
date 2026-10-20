import { describe, expect, it } from "vitest";
import {
  changeDelivery,
  initialDraft,
  validateDraft,
  type CheckoutDraft,
} from "./model";
export const validDraft: CheckoutDraft = {
  ...initialDraft,
  firstName: "Lucía",
  lastName: "Pérez",
  email: "lucia@example.com",
  phone: "+54 9 11 5555-1234",
  province: "Buenos Aires",
  city: "La Plata",
  postalCode: "1900",
  street: "Calle de prueba",
  streetNumber: "123",
  payment: "mercado_pago",
};
describe("Validaciones del checkout demo", () => {
  it("acepta envío con CPA o código de cuatro dígitos y números sin altura", () => {
    expect(validateDraft(validDraft)).toEqual({});
    expect(
      validateDraft({
        ...validDraft,
        postalCode: "c1000aaa",
        streetNumber: "S/N",
      }),
    ).toEqual({});
  });
  it.each([
    ["firstName", " "],
    ["firstName", "a".repeat(61)],
    ["lastName", ""],
    ["email", "sin-arroba"],
    ["email", "x@x"],
    ["email", "x".repeat(255)],
    ["phone", "123"],
    ["phone", "a1155551234"],
    ["phone", "++541155551234"],
    ["phone", "54+1155551234"],
    ["phone", "1".repeat(16)],
    ["province", "Otra"],
    ["city", ""],
    ["postalCode", "12345"],
    ["street", ""],
    ["streetNumber", "-7"],
    ["apartment", "x".repeat(41)],
    ["instructions", "x".repeat(301)],
    ["payment", ""],
    ["payment", "cash"],
  ])("rechaza %s inválido", (key, value) => {
    expect(validateDraft({ ...validDraft, [key]: value })).toHaveProperty(key);
  });
  it("no pide dirección ni inventa costos para retiro", () => {
    const draft = {
      ...initialDraft,
      firstName: "Ana",
      lastName: "Pérez",
      email: "ana@example.com",
      phone: "1155551234",
      delivery: "pickup" as const,
      payment: "cash" as const,
    };
    expect(validateDraft(draft)).toEqual({});
  });
  it("limpia efectivo al pasar a envío, conserva contacto y dirección y exige otro método", () => {
    const next = changeDelivery(
      { ...validDraft, delivery: "pickup", payment: "cash" },
      "shipping",
    );
    expect(next.payment).toBe("");
    expect(next.firstName).toBe(validDraft.firstName);
    expect(next.street).toBe(validDraft.street);
    expect(validateDraft(next)).toHaveProperty("payment");
    expect(changeDelivery(validDraft, "pickup").payment).toBe("mercado_pago");
  });
});
