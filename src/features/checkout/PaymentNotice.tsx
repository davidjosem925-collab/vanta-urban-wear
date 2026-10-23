/** Static notice, deliberately outside payment/authentication logic. */
export function PaymentNotice() {
  return (
    <aside
      className="payment-portfolio-notice"
      role="note"
      aria-label="Compra de demostración"
    >
      <h2>Compra de demostración</h2>
      <p>
        VANTA es un proyecto ficticio de portfolio. Estás por ingresar al
        entorno de pruebas de Mercado Pago. No se realizará ningún cobro real.
        Utilizá únicamente cuentas y tarjetas de prueba.
      </p>
    </aside>
  );
}
