import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureService, product } from "../test/fixtures";
import { Photo } from "./Photo";
describe("Imágenes privadas", () => {
  it("renueva una URL vencida una vez y muestra fallback ante un segundo fallo", async () => {
    const imageUrl = vi
      .fn()
      .mockResolvedValue("https://example.com/renewed.webp");
    render(
      <Photo
        image={product.images[0]}
        service={fixtureService({ imageUrl })}
        allowRetry
      />,
    );
    fireEvent.error(screen.getByRole("img"));
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        "https://example.com/renewed.webp",
      ),
    );
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("Imagen no disponible")).toBeVisible();
    expect(imageUrl).toHaveBeenCalledTimes(1);
  });
  it("permite reintentar manualmente una imagen sin URL", async () => {
    render(
      <Photo
        image={{ ...product.images[0], url: null }}
        service={fixtureService({
          imageUrl: async () => "https://example.com/retry.webp",
        })}
        allowRetry
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar imagen" }));
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        "https://example.com/retry.webp",
      ),
    );
  });
});
