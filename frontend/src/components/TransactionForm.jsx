import { useState, useEffect } from 'react';
import {
  createTransaction,
  updateTransaction,
  fetchCategories,
  fetchAccounts,
} from '../services/api';

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function TransactionForm({ transaction, onClose, onSaved }) {
  const isEdit = !!transaction;

  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [type, setType] = useState(transaction ? transaction.type : '');
  const [categoryId, setCategoryId] = useState(transaction ? transaction.category_id : '');
  const [accountId, setAccountId] = useState(transaction ? transaction.account_id : '');
  const [date, setDate] = useState(transaction ? transaction.date : todayStr());
  const [note, setNote] = useState(transaction ? transaction.note || '' : '');

  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    Promise.all([fetchCategories(), fetchAccounts()])
      .then(([cats, accts]) => {
        setCategories(cats);
        setAccounts(accts);
      })
      .catch(() => {
        // Silently fail — user will see empty dropdowns
      });
  }, []);

  function validate() {
    const newErrors = {};
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
    }
    if (!type) {
      newErrors.type = 'Please select a type';
    }
    if (!categoryId) {
      newErrors.categoryId = 'Please select a category';
    }
    if (!accountId) {
      newErrors.accountId = 'Please select a bank account';
    }
    if (!date) {
      newErrors.date = 'Date is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(null);

    if (!validate()) return;

    const payload = {
      amount: parseFloat(amount),
      type,
      category_id: Number(categoryId),
      account_id: Number(accountId),
      date,
      note: note.trim(),
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateTransaction(transaction.id, payload);
      } else {
        await createTransaction(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setSubmitError(err.message || 'Failed to save transaction');
    } finally {
      setSubmitting(false);
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit transaction' : 'Add transaction'}>
      <div className="modal-content">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Transaction' : 'Add Transaction'}</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form className="transaction-form" onSubmit={handleSubmit} noValidate>
          {/* Amount */}
          <div className="form-field">
            <label htmlFor="txn-amount">Amount</label>
            <input
              id="txn-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {errors.amount && <span className="field-error">{errors.amount}</span>}
          </div>

          {/* Type */}
          <div className="form-field">
            <label htmlFor="txn-type">Type</label>
            <select
              id="txn-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">-- Select type --</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
            {errors.type && <span className="field-error">{errors.type}</span>}
          </div>

          {/* Category */}
          <div className="form-field">
            <label htmlFor="txn-category">Category</label>
            <select
              id="txn-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">-- Select category --</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            {errors.categoryId && <span className="field-error">{errors.categoryId}</span>}
          </div>

          {/* Bank Account */}
          <div className="form-field">
            <label htmlFor="txn-account">Bank Account</label>
            <select
              id="txn-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">-- Select account --</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
            {errors.accountId && <span className="field-error">{errors.accountId}</span>}
          </div>

          {/* Date */}
          <div className="form-field">
            <label htmlFor="txn-date">Date</label>
            <input
              id="txn-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {errors.date && <span className="field-error">{errors.date}</span>}
          </div>

          {/* Note */}
          <div className="form-field">
            <label htmlFor="txn-note">Note (optional)</label>
            <input
              id="txn-note"
              type="text"
              placeholder="Add a note..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {/* Submit error */}
          {submitError && <p className="form-submit-error">{submitError}</p>}

          {/* Actions */}
          <div className="form-actions">
            <button type="button" className="form-cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="form-save-btn" disabled={submitting}>
              {submitting ? 'Saving...' : isEdit ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
