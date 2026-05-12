import { useState, useEffect } from 'react';
import {
  fetchAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
} from '../services/api';

export default function AccountManager({ onClose, onChanged }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newBalance, setNewBalance] = useState('');
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [editError, setEditError] = useState(null);

  // Conflict modal state
  const [conflictAccount, setConflictAccount] = useState(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAccounts();
      setAccounts(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  }

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setAddError('Account name is required');
      return;
    }
    const initial_balance = parseFloat(newBalance) || 0;
    setAdding(true);
    setAddError(null);
    try {
      const created = await createAccount({ name, initial_balance });
      setAccounts((prev) => [...prev, created]);
      setNewName('');
      setNewBalance('');
      if (onChanged) onChanged();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(account) {
    setEditingId(account.id);
    setEditName(account.name);
    setEditBalance(String(account.initial_balance ?? account.current_balance ?? 0));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditBalance('');
    setEditError(null);
  }

  async function saveEdit(id) {
    const name = editName.trim();
    if (!name) {
      setEditError('Account name is required');
      return;
    }
    const initial_balance = parseFloat(editBalance) || 0;
    try {
      const updated = await updateAccount(id, { name, initial_balance });
      setAccounts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...updated } : a))
      );
      setEditingId(null);
      setEditName('');
      setEditBalance('');
      setEditError(null);
      if (onChanged) onChanged();
    } catch (err) {
      setEditError(err.message);
    }
  }

  async function handleDelete(account) {
    const confirmed = window.confirm(
      `Delete account "${account.name}"?`
    );
    if (!confirmed) return;

    try {
      await deleteAccount(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      if (onChanged) onChanged();
    } catch (err) {
      if (err.status === 409) {
        setConflictAccount(account);
      } else {
        alert('Failed to delete account: ' + err.message);
      }
    }
  }

  function dismissConflict() {
    setConflictAccount(null);
  }

  if (loading) {
    return (
      <div className="account-manager">
        <div className="account-manager-header">
          <h2>Bank Accounts</h2>
          {onClose && (
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <p className="account-manager-loading">Loading accounts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="account-manager">
        <div className="account-manager-header">
          <h2>Bank Accounts</h2>
          {onClose && (
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <p className="account-manager-error">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="account-manager">
      <div className="account-manager-header">
        <h2>Bank Accounts</h2>
        {onClose && (
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      {/* Add account form */}
      <form className="account-add-form" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="Account name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={adding}
          aria-label="New account name"
        />
        <input
          type="number"
          placeholder="Initial balance"
          value={newBalance}
          onChange={(e) => setNewBalance(e.target.value)}
          disabled={adding}
          step="0.01"
          aria-label="Initial balance"
        />
        <button type="submit" disabled={adding} className="account-add-btn">
          {adding ? 'Adding...' : 'Add'}
        </button>
      </form>
      {addError && <p className="account-form-error">{addError}</p>}

      {/* Account list */}
      <ul className="account-list">
        {accounts.map((account) => (
          <li key={account.id} className="account-manager-item">
            {editingId === account.id ? (
              <div className="account-edit-row">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label="Edit account name"
                  autoFocus
                />
                <input
                  type="number"
                  value={editBalance}
                  onChange={(e) => setEditBalance(e.target.value)}
                  step="0.01"
                  aria-label="Edit initial balance"
                />
                <button
                  className="account-save-btn"
                  onClick={() => saveEdit(account.id)}
                >
                  Save
                </button>
                <button
                  className="account-cancel-btn"
                  onClick={cancelEdit}
                >
                  Cancel
                </button>
                {editError && (
                  <span className="account-form-error">{editError}</span>
                )}
              </div>
            ) : (
              <div className="account-display-row">
                <div className="account-info">
                  <span className="account-manager-name">{account.name}</span>
                  <span className="account-manager-balance">
                    {formatCurrency(account.current_balance ?? account.initial_balance ?? 0)}
                  </span>
                </div>
                <div className="account-controls">
                  <button
                    className="account-edit-btn"
                    onClick={() => startEdit(account)}
                    aria-label={`Edit ${account.name}`}
                  >
                    ✏️
                  </button>
                  <button
                    className="account-delete-btn"
                    onClick={() => handleDelete(account)}
                    aria-label={`Delete ${account.name}`}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {accounts.length === 0 && (
        <p className="no-data-text">No accounts yet.</p>
      )}

      {/* Conflict modal */}
      {conflictAccount && (
        <div className="modal-overlay" onClick={dismissConflict}>
          <div
            className="modal-content account-conflict-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Cannot Delete Account</h2>
              <button
                className="modal-close-btn"
                onClick={dismissConflict}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="account-conflict-body">
              <p>
                The account <strong>"{conflictAccount.name}"</strong> has
                linked transactions and cannot be deleted.
              </p>
              <p>
                Please reassign or delete those transactions before removing
                this account.
              </p>
              <button
                className="form-save-btn"
                onClick={dismissConflict}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
