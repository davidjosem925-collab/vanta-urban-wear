import { useCallback, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  isDialogBackdrop,
  trapModalFocus,
  useModalDialog,
} from "../../components/useModalDialog";
import type { CatalogService } from "./service";
import { sizeGuides } from "./sizeGuides";
import { useAsync } from "./useAsync";

export function SizeGuide({
  categoryId,
  service,
}: {
  categoryId: string;
  service: CatalogService;
}) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const id = useId();
  const { dialog, initialFocus } = useModalDialog(open);
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!open) return null;
      const categories = await service.categories(signal);
      const category = categories.find(
        (category) => category.id === categoryId && category.active,
      );
      return category && Object.hasOwn(sizeGuides, category.slug)
        ? sizeGuides[category.slug]
        : null;
    },
    [categoryId, open, service],
  );
  const state = useAsync(load, retry);
  return (
    <>
      <button
        type="button"
        className="size-guide-link"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <path d="m3 16 13-13 5 5L8 21 3 16Z" />
          <path d="m7 12 2 2m1-5 3 3m0-6 2 2" />
        </svg>
        Guía de talles
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          id={id}
          className="size-guide-dialog"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-notice`}
          onKeyDown={trapModalFocus}
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          onClick={(event) => {
            if (isDialogBackdrop(event)) setOpen(false);
          }}
        >
          <header className="size-guide-heading">
            <div>
              <p className="eyebrow">VANTA / REFERENCIAS DE CALCE</p>
              <h2 id={`${id}-title`}>
                Guía de talles<span aria-hidden="true">.</span>
              </h2>
            </div>
            <button
              type="button"
              ref={initialFocus}
              className="cart-close"
              aria-label="Cerrar guía de talles"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <div
            className="size-guide-scroll"
            tabIndex={0}
            role="region"
            aria-label="Contenido de la guía de talles"
          >
            <p id={`${id}-notice`} className="size-guide-notice">
              Medidas orientativas en centímetros. No son medidas oficiales
              verificadas ni una garantía de calce.
            </p>
            {state.status === "loading" && (
              <p role="status">Consultando la categoría…</p>
            )}
            {(state.status === "error" ||
              (state.status === "success" && !state.data)) && (
              <div className="size-guide-error" role="alert">
                <p>
                  {state.status === "error"
                    ? "No pudimos consultar la categoría. Revisá tu conexión para ver la guía correcta."
                    : "No hay una guía orientativa para esta categoría."}
                </p>
                <button
                  className="cart-text-button"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  Reintentar guía
                </button>
              </div>
            )}
            {state.status === "success" && state.data && (
              <>
                <h3>{state.data.name}</h3>
                <p className="size-guide-note">{state.data.note}</p>
                {state.data.tables.map((table) => (
                  <table key={table.caption} className="size-guide-table">
                    <caption>{table.caption} · cm</caption>
                    <thead>
                      <tr>
                        {table.columns.map((column) => (
                          <th key={column} scope="col">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map(([size, ...values]) => (
                        <tr key={size}>
                          <th scope="row">{size}</th>
                          {values.map((value, i) => (
                            <td key={table.columns[i + 1]}>{value}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
                <h3>Cómo medir</h3>
                <p className="size-guide-note">
                  Compará con una prenda similar que ya uses. Apoyala sobre una
                  superficie plana y medí sin estirar la tela; no tomes estas
                  medidas sobre el cuerpo.
                </p>
                <ul className="size-guide-instructions">
                  {state.data.instructions.map((instruction) => (
                    <li key={instruction}>{instruction}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
