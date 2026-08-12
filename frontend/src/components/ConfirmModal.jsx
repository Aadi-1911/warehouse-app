// Shared confirm dialog — 07_UI_DESIGN_BRIEF.md §3.4: "centered, dark scrim, white card
// ~300px max-width, 16px radius. Two full-width buttons (Cancel outline / Confirm filled in
// the action's theme color). Used for every mutation that changes persisted data... body copy
// always names the concrete consequence, never a generic 'are you sure?'"
//
// First built for Manage Users' deactivate/reactivate toggles (an accidental tap has a real,
// immediate effect — auth.js rejects that user's very next request), but deliberately generic
// so any future screen's mutations can reuse it rather than each screen rolling its own.
export default function ConfirmModal({ open, title, body, confirmLabel, tone = 'accent', onConfirm, onCancel }) {
  if (!open) return null;

  return (
    // The scrim itself is also a cancel target — clicking outside the card is the expected
    // "back out" gesture, same as pressing Cancel.
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{title}</h2>
        <p className="modal-body">{body}</p>
        <div className="modal-actions">
          <button type="button" className="btn-modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn-modal-confirm btn-modal-confirm-${tone}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
