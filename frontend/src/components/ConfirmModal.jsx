// Shared confirm dialog — 07_UI_DESIGN_BRIEF.md §3.4: "centered, dark scrim, white card
// ~300px max-width, 16px radius. Two full-width buttons (Cancel outline / Confirm filled in
// the action's theme color). Used for every mutation that changes persisted data... body copy
// always names the concrete consequence, never a generic 'are you sure?'"
//
// First built for Manage Users' deactivate/reactivate toggles (an accidental tap has a real,
// immediate effect — auth.js rejects that user's very next request), but deliberately generic
// so any future screen's mutations can reuse it rather than each screen rolling its own.
// `cancelLabel` defaults to "Cancel" so every existing caller is unaffected. It exists because
// Pack Order has literal "Cancel this line"/"Cancel this order" actions on the same screen, where
// a dismiss button reading just "Cancel" is genuinely ambiguous about which cancel it means.
//
// `children` (added 2026-08-25, for Bill Order's discount/GST questions) — an optional block
// rendered between the body text and the action buttons, for a confirm flow that needs a small
// amount of real input before the destructive action, not just a plain description of it. Kept
// as a separate prop rather than folding into `body` (which stays plain text) so every existing
// caller — a `body` string wrapped in one `<p>` — is completely unaffected; `undefined` renders
// nothing, same as omitting it today. `confirmDisabled` (also new, default false) exists for the
// same reason: a destructive confirm shouldn't be pressable while `children`'s own input is
// incomplete or invalid, same spirit as this screen's own "blocked lines disable Bill" guard.
//
// `hideConfirm` (added 2026-09-27 for rule 113's PIN step, default false) removes this modal's own
// confirm button entirely, leaving Cancel. It exists because `children` can contain a PinPrompt
// (components/PinPrompt.jsx), which owns its own <form> and its own submit button — and when it
// does, THAT button is the action. The established pattern everywhere PinPrompt is already used
// (dashboard/History.jsx, dashboard/Parties.jsx, ReceiveStock.jsx) is that PinPrompt REPLACES the
// plain confirm button rather than sitting beside it; a disabled "Bill and lock order" left visible
// above an active "Confirm at new prices" would be two primary buttons for one action, with the
// dead one on top. Cancel deliberately stays: backing out must always be available.
export default function ConfirmModal({
  open,
  title,
  body,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'accent',
  onConfirm,
  onCancel,
  confirmDisabled = false,
  hideConfirm = false,
}) {
  if (!open) return null;

  return (
    // The scrim itself is also a cancel target — clicking outside the card is the expected
    // "back out" gesture, same as pressing Cancel.
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{title}</h2>
        <p className="modal-body">{body}</p>
        {children}
        <div className="modal-actions">
          <button type="button" className="btn-modal-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          {!hideConfirm && (
            <button
              type="button"
              className={`btn-modal-confirm btn-modal-confirm-${tone}`}
              onClick={onConfirm}
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
