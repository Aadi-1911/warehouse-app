// navigator.clipboard.writeText requires a "secure context" (HTTPS, or the browser's own notion
// of localhost) per the Clipboard API spec. This app is deliberately served over plain HTTP on a
// LAN IP for day-to-day phone/desktop use (frontend/.env's own comment explains why), which is
// NOT a secure context — confirmed 2026-08-20 against the real LAN URL: window.isSecureContext
// was false, navigator.clipboard was undefined entirely (not just missing writeText), and calling
// it threw an uncaught TypeError with no visible feedback to the user.
//
// document.execCommand('copy') is deprecated but has no secure-context requirement — it still
// works today in every browser this app runs on, so it's the real fallback for the LAN
// deployment this app actually runs under, not just a defensive no-op for a case that can't
// happen in practice.
//
// Returns a boolean rather than throwing, so every caller can just branch on success/failure
// instead of each writing its own try/catch around two different copy mechanisms.
export async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path — some browsers expose navigator.clipboard but still
      // reject the call outside a secure context or a direct user gesture.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Off-screen but still focusable/selectable — execCommand('copy') only acts on the current
  // selection, so this element has to actually receive focus and a real selection for the
  // browser to have anything to copy.
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  }
  document.body.removeChild(textarea);
  return succeeded;
}
