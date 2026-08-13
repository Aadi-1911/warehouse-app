import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { UsersIcon, ChevronIcon } from '../components/icons';
import ScreenHeader from '../components/ScreenHeader';
import ConfirmModal from '../components/ConfirmModal';
import { listUsers, createUser, deactivateUser, reactivateUser, resetUserPassword } from '../api/users';

const MIN_PASSWORD_LENGTH = 8; // a sane floor, not enforced complexity (CLAUDE.md: no symbol/number rules here)

// Manage Users — 01_PRD.md §95. Owner-only, low-frequency use; not part of
// 07_UI_DESIGN_BRIEF.md (that brief covers staff-facing screens only), so this screen's visual
// shape is built from the shared design tokens/components rather than a screen-specific spec.
const ROLE_DESCRIPTIONS = {
  STAFF: 'Logs stock movements and manages day-to-day inventory. Never sees cost price, and cannot edit prices or manage accounts.',
  OWNER: 'Full access, including PIN-gated price editing and account management.',
};

export default function ManageUsers() {
  const { user: authUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('STAFF');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Drives the confirm modal — null when closed, otherwise which user and which action.
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Which row is expanded to show its actions — a single id (or null), not a Set, since only
  // one row is ever open at a time (requirement 3), unlike Live Stock's accordion where any
  // number of sections can be open independently.
  const [expandedUserId, setExpandedUserId] = useState(null);

  // Reset Password — deliberately separate state from confirmTarget/ConfirmModal above (do not
  // touch Deactivate/Reactivate's existing behavior). null | the user row being reset. Uses the
  // same lightweight inline PIN-prompt pattern as Factory Payables/Article Pricing instead of a
  // modal — the PIN entry itself is the confirmation step.
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetPin, setResetPin] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetSubmitError, setResetSubmitError] = useState(null);
  const [resetAttemptsRemaining, setResetAttemptsRemaining] = useState(null);
  // Kept separate from resetTarget so the confirmation banner can survive the form closing —
  // captures the name/password at the moment of success, since newPassword gets cleared right
  // after (requirement 6: this system has no other way to tell the person their new password).
  const [resetSuccess, setResetSuccess] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((data) => {
        if (!cancelled) setUsers(data);
      })
      .catch((err) => {
        if (!cancelled) setListError(err.message);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only a primary owner can create another OWNER account (04_API_SPEC.md, rule 74) — hiding
  // the option entirely for anyone else, per 01_PRD.md §95's explicit instruction, rather than
  // showing it and letting the inevitable 403 explain itself.
  const canCreateOwner = authUser.isPrimaryOwner;

  // Used below to proactively disable a deactivate action that the backend would reject
  // anyway (userController.js's two lockout guards) — better to not offer a doomed action than
  // to let someone tap it and read an error.
  const activeOwnerCount = users.filter((u) => u.role === 'OWNER' && u.isActive).length;

  async function handleCreate(event) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const created = await createUser({ name, username, password, role });
      setUsers((prev) => [...prev, created]);
      setName('');
      setUsername('');
      setPassword('');
      setRole('STAFF');
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmAction() {
    if (!confirmTarget) return;
    setActionError(null);
    setActionInFlight(true);
    try {
      const action = confirmTarget.action === 'deactivate' ? deactivateUser : reactivateUser;
      const updated = await action(confirmTarget.user.id);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setConfirmTarget(null);
    } catch (err) {
      setActionError(err.message);
      setConfirmTarget(null);
    } finally {
      setActionInFlight(false);
    }
  }

  // Opens the inline reset-password form for a row. Closes/clears any previous reset attempt
  // (including a still-visible success banner from resetting a DIFFERENT person) so nothing
  // about the new form could be confused for leftover state from the last one.
  function handleStartResetPassword(u) {
    setResetTarget(u);
    setNewPassword('');
    setConfirmPassword('');
    setResetPin('');
    setResetSubmitError(null);
    setResetAttemptsRemaining(null);
    setResetSuccess(null);
  }

  function handleCancelResetPassword() {
    setResetTarget(null);
    setNewPassword('');
    setConfirmPassword('');
    setResetPin('');
    setResetSubmitError(null);
    setResetAttemptsRemaining(null);
  }

  // Expanding/collapsing a row is purely presentational (requirement 4 — no permission logic
  // here), but it does need to keep resetTarget consistent: a Reset Password form belongs to
  // whichever row is currently expanded, so switching rows (or collapsing the one that's open)
  // cancels an in-progress reset rather than leaving resetTarget pointed at a now-hidden row —
  // which would otherwise keep rowActionsDisabled blocking every other row for no visible reason.
  function handleToggleRow(u) {
    if (expandedUserId === u.id) {
      setExpandedUserId(null);
      if (resetTarget?.id === u.id) handleCancelResetPassword();
    } else {
      setExpandedUserId(u.id);
      if (resetTarget && resetTarget.id !== u.id) handleCancelResetPassword();
    }
  }

  async function handleSubmitResetPassword(event) {
    event.preventDefault();
    setResetSubmitError(null);
    setResetAttemptsRemaining(null);

    // Both client-side checks below must reject BEFORE the request ever goes out — a mismatched
    // Confirm Password should never even reach the PIN step (requirement/test case), and there's
    // no reason to spend a PIN attempt on a password that's already known to be unusable.
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setResetSubmitError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetSubmitError('Passwords do not match.');
      return;
    }
    if (!resetPin) {
      setResetSubmitError('Enter your PIN.');
      return;
    }

    setResetSubmitting(true);
    try {
      await resetUserPassword(resetTarget.id, { newPassword, pin: resetPin });
      // The person's new password only ever existed in this form — capture it here for the
      // confirmation banner before clearing the fields, since there's no other record of it
      // anywhere (not stored back from the API response, which never echoes it either).
      setResetSuccess({ userName: resetTarget.name, password: newPassword });
      setResetTarget(null);
      setNewPassword('');
      setConfirmPassword('');
      setResetPin('');
    } catch (err) {
      if (err.code === 'INVALID_PIN' && err.extra?.attemptsRemaining != null) {
        setResetAttemptsRemaining(err.extra.attemptsRemaining);
      }
      setResetSubmitError(err.message);
      // Never leave a wrong PIN sitting in the field for a retry, same as Factory Payables —
      // newPassword/confirmPassword stay put since those weren't what was wrong.
      setResetPin('');
    } finally {
      setResetSubmitting(false);
    }
  }

  return (
    <div className="page">
      <ScreenHeader icon={<UsersIcon size={20} />} title="Manage Users" />

      <div className="card">
        <h2 className="card-title">Create account</h2>

        <form onSubmit={handleCreate}>
          <label className="field">
            <span className="field-label">Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <label className="field">
            <span className="field-label">Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="STAFF">Staff</option>
              {canCreateOwner && <option value="OWNER">Owner</option>}
            </select>
          </label>
          <p className="muted hint-text">{ROLE_DESCRIPTIONS[role]}</p>

          {createError && (
            <p className="error-banner" role="alert">
              {createError}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>

      <h2 className="section-heading">Accounts</h2>

      {listError && (
        <p className="error-banner" role="alert">
          Could not load users: {listError}
        </p>
      )}
      {actionError && (
        <p className="error-banner" role="alert">
          {actionError}
        </p>
      )}

      {resetSuccess && (
        <div className="result-banner result-banner-success">
          <p>
            Password reset for <strong>{resetSuccess.userName}</strong>. Tell them their new
            password directly — there's no other way for them to find out:{' '}
            <strong>{resetSuccess.password}</strong>
          </p>
          <button type="button" className="link-button" onClick={() => setResetSuccess(null)}>
            OK
          </button>
        </div>
      )}

      {listLoading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card user-list">
          {users.map((u) => {
            const isSelf = u.id === authUser.id;
            const isLastActiveOwner = u.role === 'OWNER' && u.isActive && activeOwnerCount <= 1;

            // Mirrors the backend's own restriction (rule 97): a non-primary OWNER can reset
            // their own password or any STAFF account's, but not a DIFFERENT OWNER's — hidden
            // entirely rather than shown-then-403, same reasoning as canCreateOwner above.
            const canResetPassword = authUser.isPrimaryOwner || u.role !== 'OWNER' || isSelf;

            // Any in-progress action anywhere in the list disables the rest, so a slow request
            // can't be raced by a second tap on a different row while it's still in flight.
            // Unchanged by tap-to-expand (requirement 4) — still exactly the same gate it was
            // when the actions were always visible.
            const rowActionsDisabled = actionInFlight || resetSubmitting || (!!resetTarget && resetTarget.id !== u.id);

            const expanded = expandedUserId === u.id;
            const resettingThisRow = resetTarget?.id === u.id;

            return (
              <div key={u.id} className="user-row">
                {/* Collapsed by default (requirement 1) — tapping toggles this row open/closed
                    and, since expandedUserId holds a single id, implicitly collapses whatever
                    else was open (requirement 3). Matches Live Stock's accordion pattern
                    visually (chevron, same .chevron/.chevron-open classes) without reusing its
                    title/subtitle shape, which doesn't fit a user row. */}
                <button
                  type="button"
                  className="user-row-header"
                  onClick={() => handleToggleRow(u)}
                  aria-expanded={expanded}
                >
                  <div className="user-row-info">
                    <div className="user-row-name">
                      {u.name}
                      {u.isPrimaryOwner && (
                        <span className="badge badge-purple user-row-primary-badge">Primary</span>
                      )}
                    </div>
                    <div className="muted user-row-username">{u.username}</div>
                  </div>

                  <span className={`badge ${u.role === 'OWNER' ? 'badge-purple' : 'badge-accent'}`}>
                    {u.role}
                  </span>
                  <span className={`badge ${u.isActive ? 'badge-success' : 'badge-danger'}`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>

                  <ChevronIcon className={expanded ? 'chevron chevron-open' : 'chevron'} />
                </button>

                {expanded && (
                  <div className="user-row-body">
                    {resettingThisRow ? (
                      // Same lightweight inline PIN prompt as before (requirement 2) — the PIN
                      // field IS the confirmation step, no ConfirmModal on top of this one —
                      // just relocated inside the expanded row instead of a separate card
                      // rendered below the whole list. handleSubmitResetPassword/
                      // handleCancelResetPassword are untouched (requirement 4).
                      <form onSubmit={handleSubmitResetPassword}>
                        <label className="field">
                          <span className="field-label">New Password</span>
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            autoComplete="new-password"
                            minLength={MIN_PASSWORD_LENGTH}
                            disabled={resetSubmitting}
                            required
                          />
                        </label>

                        <label className="field">
                          <span className="field-label">Confirm Password</span>
                          <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            autoComplete="new-password"
                            minLength={MIN_PASSWORD_LENGTH}
                            disabled={resetSubmitting}
                            required
                          />
                        </label>

                        <label className="field">
                          <span className="field-label">Your PIN</span>
                          <input
                            type="password"
                            inputMode="numeric"
                            value={resetPin}
                            onChange={(e) => setResetPin(e.target.value)}
                            autoComplete="off"
                            disabled={resetSubmitting}
                            required
                          />
                        </label>

                        {resetSubmitError && (
                          <p className="error-banner" role="alert">
                            {resetSubmitError}
                            {resetAttemptsRemaining != null &&
                              ` (${resetAttemptsRemaining} attempt${resetAttemptsRemaining === 1 ? '' : 's'} remaining)`}
                          </p>
                        )}

                        <button type="submit" className="btn-primary" disabled={resetSubmitting}>
                          {resetSubmitting ? 'Resetting…' : 'Confirm reset'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleCancelResetPassword}
                          disabled={resetSubmitting}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="user-row-actions">
                        {u.isActive ? (
                          isSelf ? (
                            <span className="muted user-row-disabled-note">You</span>
                          ) : isLastActiveOwner ? (
                            <span className="muted user-row-disabled-note">Last active owner</span>
                          ) : (
                            <button
                              type="button"
                              className="link-button danger-text"
                              onClick={() => setConfirmTarget({ user: u, action: 'deactivate' })}
                              disabled={rowActionsDisabled}
                            >
                              Deactivate
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => setConfirmTarget({ user: u, action: 'reactivate' })}
                            disabled={rowActionsDisabled}
                          >
                            Reactivate
                          </button>
                        )}

                        {canResetPassword && (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => handleStartResetPassword(u)}
                            disabled={rowActionsDisabled}
                          >
                            Reset Password
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={!!confirmTarget}
        title={confirmTarget?.action === 'deactivate' ? 'Deactivate this account?' : 'Reactivate this account?'}
        body={
          confirmTarget?.action === 'deactivate'
            ? `${confirmTarget?.user.name} will be signed out immediately and won't be able to log in again until reactivated. Their past activity stays fully intact.`
            : `${confirmTarget?.user.name} will be able to log in again immediately.`
        }
        confirmLabel={
          actionInFlight
            ? 'Working…'
            : confirmTarget?.action === 'deactivate'
            ? 'Deactivate'
            : 'Reactivate'
        }
        tone={confirmTarget?.action === 'deactivate' ? 'danger' : 'success'}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
