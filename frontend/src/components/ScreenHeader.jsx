import { Link } from 'react-router-dom';
import { BackIcon } from './icons';

// The screen header pattern described in 07_UI_DESIGN_BRIEF.md §3.2 ("icon mark + two-line text
// block... present on every screen") — extracted here as the one real component every screen
// renders, instead of each screen re-typing the same JSX independently. Before this, all 8
// screens had their own inline copy; nothing enforced that a 9th screen (or an edit to the
// pattern itself) would stay in sync with the other 8 — see LEARNING_LOG.md for why that's the
// same risk already logged once for costPrice's product-select leak, and why extraction, not a
// patch to all 8 files, is the fix.
//
// showBackLink is a fixed link to "/", not browser history and not a breadcrumb — going "back"
// on a warehouse floor app always means "return to Home," never "undo my last screen," since
// staff jump between screens directly from Home rather than drilling through a hierarchy. A real
// <Link>, not a button + navigate(-1)/navigate('/'), for the same reason already logged for
// Home's tiles: an anchor is what the platform already understands as navigation (middle-click,
// hover preview, assistive-tech announcement all come for free).
//
// Defaults to true because 6 of the 8 current screens want it; Home explicitly opts out (nothing
// to go back to) and Login explicitly opts out (unauthenticated — a link to "/" would just hit
// ProtectedRoute's redirect and bounce back to Login itself, a dead control dressed as a working
// one).
export default function ScreenHeader({
  icon,
  tone = 'accent',
  eyebrow = 'Warehouse',
  title,
  titleClassName = 'screen-title',
  showBackLink = true,
  children,
}) {
  return (
    <header className="screen-header">
      {showBackLink && (
        <Link to="/" className="screen-header-back" aria-label="Back to Home">
          <BackIcon size={20} />
        </Link>
      )}
      <div className={`icon-mark ${tone}`}>{icon}</div>
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className={titleClassName}>{title}</h1>
      </div>
      {children}
    </header>
  );
}
