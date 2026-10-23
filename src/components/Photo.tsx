import { imageCaption } from "../features/catalog/presentation";
import { useState } from "react";
import type { CatalogImage, CatalogService } from "../features/catalog/service";
import {
  imageProfiles,
  type ImageProfile,
} from "../features/catalog/imageProfiles";

type Props = {
  image?: CatalogImage;
  service: CatalogService;
  eager?: boolean;
  allowRetry?: boolean;
  profile?: ImageProfile;
};
export function Photo(props: Props) {
  const profile = props.profile ?? "detail";
  const optimized = props.image?.optimized?.[profile];
  return (
    <PhotoContent
      key={`${props.image?.id}/${props.image?.url}/${optimized?.url}/${profile}`}
      {...props}
      profile={profile}
    />
  );
}
function PhotoContent({
  image,
  service,
  eager = false,
  allowRetry = false,
  profile = "detail",
}: Props) {
  const optimized = image?.optimized?.[profile];
  const [usingOriginal, setUsingOriginal] = useState(!optimized?.url);
  const [url, setUrl] = useState(optimized?.url || image?.url);
  const [retried, setRetried] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const path = usingOriginal ? image?.storage_path : optimized?.path;
  async function recover(force = false) {
    setLoaded(false);
    if (!usingOriginal && image?.url) {
      setUsingOriginal(true);
      setUrl(image.url);
      return;
    }
    setUrl(null);
    if (!path || (retried && !force)) return;
    setRetried(true);
    try {
      setUrl(await service.imageUrl(path, true));
    } catch {
      /* Keep the accessible, stable placeholder. */
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
              ? `${imageCaption(image.alt)}: imagen no disponible`
              : "Fotografía próximamente"
          }
        />
        <span aria-hidden="true">V</span>
        <small>
          {image ? "Imagen no disponible" : "Fotografía próximamente"}
        </small>
        {image && allowRetry && (
          <button
            type="button"
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
  const dimensions = imageProfiles[profile];
  return (
    <span className={`photo-frame ${loaded ? "is-loaded" : "is-loading"}`}>
      <img
        src={url}
        alt={imageCaption(image?.alt ?? "")}
        width={dimensions.width}
        height={dimensions.height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          void recover();
        }}
      />
      {!loaded && (
        <span className="photo-loading" aria-hidden="true">
          V
        </span>
      )}
    </span>
  );
}
