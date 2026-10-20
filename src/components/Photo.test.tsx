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

describe("Perfiles de imagen y estabilidad", () => {
  it("prefiere WebP privado y vuelve al original si el derivado falla", async () => {
    const original = product.images[0];
    const imageUrl = vi
      .fn()
      .mockResolvedValue("https://example.com/renewed.webp");
    render(
      <Photo
        image={{
          ...original,
          optimized: {
            thumb: {
              path: "private-thumb.webp",
              url: "https://example.com/thumb.webp",
            },
          },
        }}
        profile="thumb"
        service={fixtureService({ imageUrl })}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/thumb.webp");
    expect(img).toHaveAttribute("width", "240");
    expect(img).toHaveAttribute("height", "360");
    expect(img).toHaveAttribute("loading", "lazy");
    fireEvent.load(img);
    fireEvent.error(img);
    expect(screen.getByRole("img")).toHaveAttribute("src", original.url);
    expect(imageUrl).not.toHaveBeenCalled();
    fireEvent.error(screen.getByRole("img"));
    await waitFor(() =>
      expect(imageUrl).toHaveBeenCalledWith(original.storage_path, true),
    );
  });
  it("actualiza URLs renovadas al navegar sin retener la fuente anterior", () => {
    const service = fixtureService();
    const view = render(
      <Photo image={product.images[0]} service={service} eager />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("loading", "eager");
    view.rerender(
      <Photo
        image={{
          ...product.images[0],
          url: "https://example.com/new-signed.webp",
        }}
        service={service}
        eager
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://example.com/new-signed.webp",
    );
  });
});
