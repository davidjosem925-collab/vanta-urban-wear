import { useState } from "react";
import { ArrowIcon } from "../../components/ArrowIcon";
import type { CatalogProduct } from "../catalog/service";
import { useCart } from "./context";
import { MAX_QUANTITY, validQuantity } from "./model";

export function AddToCart({
  product,
  color,
  size,
}: {
  product: CatalogProduct;
  color: string;
  size: string;
}) {
  const cart = useCart();
  const [quantity, setQuantity] = useState("1");
  const [feedback, setFeedback] = useState<{
    selection: string;
    message: string;
    success: boolean;
  } | null>(null);
  const key = `${color}/${size}/${quantity}`;
  const visible = feedback?.selection === key ? feedback : null;
  return (
    <form
      className="cart-add"
      onSubmit={async (event) => {
        event.preventDefault();
        setFeedback(null);
        try {
          await cart.add(product, color, size, Number(quantity));
          setFeedback({
            selection: key,
            message: "Prenda agregada al carrito.",
            success: true,
          });
        } catch (error) {
          setFeedback({
            selection: key,
            message:
              error instanceof Error
                ? error.message
                : "No pudimos agregar esta prenda.",
            success: false,
          });
        }
      }}
      noValidate
    >
      <label htmlFor="product-quantity">Cantidad</label>
      <div className="cart-add-controls">
        <input
          id="product-quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QUANTITY}
          step={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          aria-describedby="cart-limit cart-add-feedback"
          aria-invalid={
            visible && !validQuantity(Number(quantity)) ? true : undefined
          }
          disabled={cart.adding}
        />
        <button
          className="button primary"
          type="submit"
          aria-describedby="cart-add-feedback"
          disabled={cart.adding || !product.variants.some((v) => v.active)}
        >
          {cart.adding ? "Verificando…" : "Agregar al carrito"}
        </button>
      </div>
      <p id="cart-limit" className="muted small">
        Hasta {MAX_QUANTITY} unidades por variante. Es un límite del carrito, no
        una confirmación de stock.
      </p>
      <div
        id="cart-add-feedback"
        className={`cart-add-feedback ${visible?.success ? "is-success" : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {visible && (
          <>
            <p>{visible.message}</p>
            {visible.success && (
              <button
                type="button"
                className="cart-text-button"
                onClick={cart.openCart}
              >
                Ver carrito <ArrowIcon />
              </button>
            )}
          </>
        )}
      </div>
    </form>
  );
}
