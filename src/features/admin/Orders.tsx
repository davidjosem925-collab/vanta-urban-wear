import { useCallback, useEffect, useRef, useState } from "react";
import { connected, rows, rpc } from "./client";
import {
  type DemoOrder,
  type OrderItem,
  type Reservation,
  money,
  date,
} from "./model";
import { friendly } from "./ux";
import { OrderPayments } from "./OrderPayments";
import {
  type OrderPayments as PaymentData,
  emptyPayments,
  paymentLabel,
} from "./paymentModel";
export function Orders({
  onUnauthorized,
  selectedId,
  navigate,
}: {
  onUnauthorized(): void;
  selectedId?: string;
  navigate(target: string): void;
}) {
  const [orders, setOrders] = useState<DemoOrder[]>([]),
    [page, setPage] = useState(0),
    [filter, setFilter] = useState({
      status: "all",
      ref: "",
      from: "",
      to: "",
    }),
    [selected, setSelected] = useState<DemoOrder | null>(null),
    [items, setItems] = useState<OrderItem[]>([]),
    [reservations, setReservations] = useState<Reservation[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const [payments, setPayments] = useState<PaymentData[]>([]);
  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    setError("");
    try {
      if (!(await rpc<boolean>("is_admin", {}))) {
        onUnauthorized();
        return;
      }
      let q = connected()
        .from("orders")
        .select(
          "id,public_reference,status,created_at,reservation_expires_at,reservation_resolved_at,subtotal_cents,delivery,demo_payment",
        )
        .eq("is_demo", true)
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 19);
      if (filter.status !== "all") q = q.eq("status", filter.status);
      if (filter.ref) {
        if (!/^[a-f0-9-]{36}$/.test(filter.ref))
          throw new Error(
            "Ingresá la referencia completa del pedido, tal como aparece en su detalle.",
          );
        q = q.eq("public_reference", filter.ref);
      }
      if (filter.from)
        q = q.gte(
          "created_at",
          new Date(`${filter.from}T00:00:00`).toISOString(),
        );
      if (filter.to)
        q = q.lte(
          "created_at",
          new Date(`${filter.to}T23:59:59.999`).toISOString(),
        );
      const result = await rows<DemoOrder[]>(q);
      const ps = await rpc<PaymentData[]>("admin_demo_order_payments", {
        p_orders: result.map((o) => o.id),
      });
      if (id === generation.current) {
        setOrders(result);
        setPayments(ps);
      }
    } catch (e) {
      if (id === generation.current) setError((e as Error).message);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [filter, page, onUnauthorized]);
  const detail = useCallback(
    async (order: { id: string }) => {
      const id = ++generation.current;
      setLoading(true);
      setError("");
      setSelected(null);
      try {
        if (!(await rpc<boolean>("is_admin", {}))) {
          onUnauthorized();
          return;
        }
        // Recheck demo scope for detail too; never request contact/address or capabilities.
        const list = await rows<DemoOrder[]>(
          connected()
            .from("orders")
            .select(
              "id,public_reference,status,created_at,reservation_expires_at,reservation_resolved_at,subtotal_cents,delivery,demo_payment",
            )
            .eq("is_demo", true)
            .eq("id", order.id),
        );
        if (!list.length) throw new Error("Pedido no disponible.");
        const [ps, is, rs] = await Promise.all([
          rpc<PaymentData[]>("admin_demo_order_payments", {
            p_orders: [order.id],
          }),
          rows<OrderItem[]>(
            connected()
              .from("order_items")
              .select(
                "id,product_name,sku,size,color,quantity,unit_price_cents,line_total_cents",
              )
              .eq("order_id", order.id),
          ),
          rows<Reservation[]>(
            connected()
              .from("stock_reservations")
              .select("id,variant_id,quantity,status,expires_at")
              .eq("order_id", order.id),
          ),
        ]);
        if (id !== generation.current) return;
        setPayments(ps);
        setItems(is);
        setReservations(rs);
        setSelected(list[0]);
      } catch (e) {
        if (id === generation.current) setError((e as Error).message);
      } finally {
        if (id === generation.current) setLoading(false);
      }
    },
    [onUnauthorized],
  );
  useEffect(() => {
    const counter = generation;
    if (selectedId) void detail({ id: selectedId });
    else {
      setSelected(null);
      void load();
    }
    return () => {
      counter.current++;
    };
  }, [selectedId, detail, load]);
  return (
    <section>
      <div className="admin-toolbar">
        <h2>Pedidos de demostración</h2>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => {
            if (selectedId) void detail({ id: selectedId });
            else void load();
          }}
        >
          Actualizar pedidos
        </button>
      </div>
      <p>
        Entorno de demostración, sin cobros productivos. Pedido y pago tienen
        estados separados. Las reservas duran 60 minutos; su liberación se
        procesa automáticamente.
      </p>
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Cargando pedidos…</p>}
      {selected ? (
        <article className="admin-card">
          <button
            className="button secondary"
            onClick={() => navigate("#/admin/pedidos")}
          >
            Volver a pedidos
          </button>
          <h3>{selected.public_reference}</h3>
          <dl className="admin-facts">
            <div>
              <dt>Estado del pedido</dt>
              <dd>{friendly(selected.status)}</dd>
            </div>
            <div>
              <dt>Creado</dt>
              <dd>{date(selected.created_at)}</dd>
            </div>
            <div>
              <dt>Vencimiento</dt>
              <dd>{date(selected.reservation_expires_at)}</dd>
            </div>
            <div>
              <dt>Resolución</dt>
              <dd>
                {selected.reservation_resolved_at
                  ? date(selected.reservation_resolved_at)
                  : "Pendiente"}
              </dd>
            </div>
            <div>
              <dt>Subtotal</dt>
              <dd>{money(selected.subtotal_cents)}</dd>
            </div>
            <div>
              <dt>Modalidad demo</dt>
              <dd>
                {friendly(selected.delivery)} ·{" "}
                {friendly(selected.demo_payment)}
              </dd>
            </div>
          </dl>
          <OrderPayments
            key={selected.id}
            order={selected}
            data={
              payments.find((p) => p.order_id === selected.id) ??
              emptyPayments(selected.id)
            }
            refresh={() => detail(selected)}
          />
          <h4>Productos del pedido</h4>
          {items.map((i) => (
            <div className="admin-line" key={i.id}>
              <strong>{i.product_name}</strong>
              <p>
                {i.size} / {i.color} · {i.quantity} unidades
              </p>
              <p>
                Unitario: {money(i.unit_price_cents)} · Subtotal:{" "}
                {money(i.line_total_cents)}
              </p>
            </div>
          ))}
          <h4>Reservas</h4>
          {reservations.map((r) => (
            <p key={r.id}>
              {r.quantity} unidades · {friendly(r.status)} · vencimiento{" "}
              {date(r.expires_at)}
            </p>
          ))}
          <p className="admin-muted">
            El estado se actualiza en el servidor. Pulsá Actualizar pedidos para
            consultar el resultado más reciente.
          </p>
        </article>
      ) : selectedId ? (
        !loading && (
          <p>
            No se pudo consultar este pedido. Volvé al listado o reintentá la
            consulta.
          </p>
        )
      ) : (
        <>
          <form
            className="admin-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setPage(0);
              setFilter({
                status: String(f.get("status")),
                ref: String(f.get("ref")).trim().toLowerCase(),
                from: String(f.get("from")),
                to: String(f.get("to")),
              });
            }}
          >
            <label>
              Referencia
              <input name="ref" maxLength={36} />
            </label>
            <label>
              Estado
              <select name="status">
                {[
                  "all",
                  "pending",
                  "expired",
                  "cancelled",
                  "confirmed",
                  "preparing",
                  "delivered",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s === "all" ? "Todos" : friendly(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Desde
              <input name="from" type="date" />
            </label>
            <label>
              Hasta
              <input name="to" type="date" />
            </label>
            <button className="button secondary">Filtrar pedidos</button>
          </form>
          {!loading && !orders.length && (
            <p>No hay pedidos demo para estos filtros.</p>
          )}
          <div className="admin-product-list">
            {orders.map((o) => (
              <article className="admin-card" key={o.id}>
                <div>
                  <h3>{o.public_reference}</h3>
                  <p>
                    Pago:{" "}
                    {payments
                      .find((p) => p.order_id === o.id)
                      ?.payments.map(
                        (p) =>
                          `${p.method === "mercado_pago" ? "Mercado Pago · Pruebas" : "Transferencia / demo"} · ${paymentLabel(p.status)}`,
                      )
                      .join("; ") || "Sin operación registrada"}
                  </p>
                  <p>
                    {friendly(o.status)} · {date(o.created_at)} ·{" "}
                    {money(o.subtotal_cents)}
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => navigate(`#/admin/pedidos/${o.id}`)}
                >
                  Ver detalle
                </button>
              </article>
            ))}
          </div>
          <div className="admin-pagination">
            <button
              className="button secondary"
              disabled={!page || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>Página {page + 1}</span>
            <button
              className="button secondary"
              disabled={orders.length < 20 || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </section>
  );
}
