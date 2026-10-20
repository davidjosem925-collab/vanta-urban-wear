import {
  useModalDialog,
  trapModalFocus,
  isDialogBackdrop,
} from "../../components/useModalDialog";
export function Confirm({
  text,
  onCancel,
  onConfirm,
}: {
  text: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { dialog, initialFocus } = useModalDialog(true);
  return (
    <dialog
      className="admin-confirm"
      ref={dialog}
      aria-labelledby="admin-confirm-title"
      onKeyDown={trapModalFocus}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (isDialogBackdrop(e)) onCancel();
      }}
    >
      <h2 id="admin-confirm-title">Confirmar cambio</h2>
      <p>{text}</p>
      <div className="admin-actions">
        <button
          className="button secondary"
          ref={initialFocus}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <button className="button primary" onClick={onConfirm}>
          Confirmar cambio
        </button>
      </div>
    </dialog>
  );
}
