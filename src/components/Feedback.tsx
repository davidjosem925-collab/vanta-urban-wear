import { ArrowIcon } from "./ArrowIcon";
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="eyebrow">VANTA / COLECCIÓN</span>
      <p>Cargando colección…</p>
      <div className="skeleton-grid" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <div key={n} />
        ))}
      </div>
    </div>
  );
}
export function Feedback({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="feedback" role={retry ? "alert" : "status"}>
      <span className="eyebrow">VANTA / URBAN WEAR</span>
      <h2>{title}</h2>
      <p>{message}</p>
      {retry ? (
        <button className="button secondary" onClick={retry}>
          Reintentar{" "}
        </button>
      ) : (
        <a className="text-link" href="#/catalogo">
          Ver toda la colección <ArrowIcon />
        </a>
      )}
    </div>
  );
}
