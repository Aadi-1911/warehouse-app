import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { UsersIcon } from '../components/icons';
import ConfirmModal from '../components/ConfirmModal';
import { listUsers, createUser, deactivateUser, reactivateUser } from '../api/users';

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

  return (
    <div className="page">
      <header className="screen-header">
        <div className="icon-mark accent">
          <UsersIcon size={20} />
        </div>
        <div>
          <div className="eyebrow">Warehouse</div>
          <h1 className="screen-title">Manage Users</h1>
        </div>
      </header>

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

      {listLoading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card user-list">
          {users.map((u) => {
            const isSelf = u.id === authUser.id;
            const isLastActiveOwner = u.role === 'OWNER' && u.isActive && activeOwnerCount <= 1;

            return (
              <div key={u.id} className="user-row">
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
                    >
                      Deactivate
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setConfirmTarget({ user: u, action: 'reactivate' })}
                  >
                    Reactivate
                  </button>
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
