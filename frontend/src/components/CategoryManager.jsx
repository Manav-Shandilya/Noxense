import { useState } from 'react';
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from '../services/api';

export default function CategoryManager({ categories, setCategories, onClose, onChanged }) {
  // Add form state
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState(null);

  // Conflict modal state
  const [conflictCategory, setConflictCategory] = useState(null);

  async function handleAdd(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setAddError('Category name is required');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const created = await createCategory({ name });
      setCategories((prev) => [...prev, created]);
      setNewName('');
      if (onChanged) onChanged();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(cat) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditError(null);
  }

  async function saveEdit(id) {
    const name = editName.trim();
    if (!name) {
      setEditError('Category name is required');
      return;
    }
    try {
      await updateCategory(id, { name });
      setCategories((prev) =>
        prev.map((c) => (c.id === id ? { ...c, name } : c))
      );
      setEditingId(null);
      setEditName('');
      setEditError(null);
    } catch (err) {
      setEditError(err.message);
    }
  }

  async function handleToggleExclusion(cat) {
    const newValue = cat.excluded_from_budget ? 0 : 1;
    try {
      await updateCategory(cat.id, { excluded_from_budget: newValue });
      setCategories((prev) =>
        prev.map((c) =>
          c.id === cat.id ? { ...c, excluded_from_budget: newValue } : c
        )
      );
      if (onChanged) onChanged();
    } catch (err) {
      alert('Failed to update exclusion: ' + err.message);
    }
  }

  async function handleDelete(cat) {
    const confirmed = window.confirm(
      `Delete category "${cat.name}"?`
    );
    if (!confirmed) return;

    try {
      await deleteCategory(cat.id);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      if (onChanged) onChanged();
    } catch (err) {
      if (err.status === 409) {
        setConflictCategory(cat);
      } else {
        alert('Failed to delete category: ' + err.message);
      }
    }
  }

  function dismissConflict() {
    setConflictCategory(null);
  }

  return (
    <div className="category-manager">
      <div className="category-manager-header">
        <h2>Categories</h2>
        {onClose && (
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      {/* Add category form */}
      <form className="category-add-form" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="New category name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={adding}
          aria-label="New category name"
        />
        <button type="submit" disabled={adding} className="category-add-btn">
          {adding ? 'Adding...' : 'Add'}
        </button>
      </form>
      {addError && <p className="category-form-error">{addError}</p>}

      <p className="category-exclude-hint">
        <strong>Exclude</strong> — Transactions in this category won't count toward your monthly budget
      </p>

      {/* Category list */}
      <ul className="category-list">
        {categories.map((cat) => (
          <li key={cat.id} className="category-item">
            {editingId === cat.id ? (
              <div className="category-edit-row">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label="Edit category name"
                  autoFocus
                />
                <button
                  className="category-save-btn"
                  onClick={() => saveEdit(cat.id)}
                >
                  Save
                </button>
                <button
                  className="category-cancel-btn"
                  onClick={cancelEdit}
                >
                  Cancel
                </button>
                {editError && (
                  <span className="category-form-error">{editError}</span>
                )}
              </div>
            ) : (
              <div className="category-display-row">
                <span className="category-name">{cat.name}</span>
                <div className="category-controls">
                  <label className="exclusion-toggle" title="Exclude from budget">
                    <input
                      type="checkbox"
                      checked={!!cat.excluded_from_budget}
                      onChange={() => handleToggleExclusion(cat)}
                      aria-label={`Exclude ${cat.name} from budget`}
                    />
                    <span className="exclusion-label">Exclude</span>
                  </label>
                  <button
                    className="category-edit-btn"
                    onClick={() => startEdit(cat)}
                    aria-label={`Edit ${cat.name}`}
                  >
                    ✏️
                  </button>
                  <button
                    className="category-delete-btn"
                    onClick={() => handleDelete(cat)}
                    aria-label={`Delete ${cat.name}`}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {categories.length === 0 && (
        <p className="no-data-text">No categories yet.</p>
      )}

      {/* Conflict modal */}
      {conflictCategory && (
        <div className="modal-overlay" onClick={dismissConflict}>
          <div
            className="modal-content category-conflict-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Cannot Delete Category</h2>
              <button
                className="modal-close-btn"
                onClick={dismissConflict}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="category-conflict-body">
              <p>
                The category <strong>"{conflictCategory.name}"</strong> has
                linked transactions and cannot be deleted.
              </p>
              <p>
                Please reassign those transactions to another category before
                deleting this one.
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
