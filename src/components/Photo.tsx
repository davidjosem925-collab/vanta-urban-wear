import { useState } from "react";
import type { CatalogImage, CatalogService } from "../features/catalog/service";
export function Photo({
  image,
  service,
  eager = false,
  allowRetry = false,
}: {
  image?: CatalogImage;
  service: CatalogService;
  eager?: boolean;
  allowRetry?: boolean;
}) {
  const [url, setUrl] = useState(image?.url);
  const [retried, setRetried] = useState(false);
  async function recover(force = false) {
    setUrl(null);
    if (!image || (retried && !force)) return;
    setRetried(true);
    try {
      setUrl(await service.imageUrl(image.storage_path));
    } catch {
      /* Remain on accessible placeholder. */
    }
  }
  if (!url)
    return (
      <div className="photo-placeholder">
        <span
          className="sr-only"
          role="img"
          aria-label={
            image
              ? `${image.alt}: imagen no disponible`
              : "Fotografía próximamente"
          }
        />
        <span aria-hidden="true">V</span>
        <small>
          {image ? "Imagen no disponible" : "Fotografía próximamente"}
        </small>
        {image && allowRetry && (
          <button
            className="image-retry"
            onClick={() => {
              void recover(true);
            }}
          >
            Reintentar imagen
          </button>
        )}
      </div>
    );
  return (
    <img
      src={url}
      alt={image?.alt ?? ""}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => {
        void recover();
      }}
    />
  );
}
