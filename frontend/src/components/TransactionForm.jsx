import { useState } from 'react';
import {
  createTransaction,
  updateTransaction,
} from '../services/api';
import { checkBudgetAfterMutation } from '../services/notifications';

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function TransactionForm({ transaction, categories, accounts, onClose, onSaved }) {
  const isEdit = !!transaction;

  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [type, setType] = useState(transaction ? transaction.type : '');
  const [categoryId, setCategoryId] = useState(transaction ? transaction.category_id : '');
  const [accountId, setAccountId] = useState(transaction ? transaction.account_id : '');
  const [toAccountId, setToAccountId] = useState(transaction ? transaction.to_account_id || '' : '');
  const [date, setDate] = useState(transaction ? transaction.date : todayStr());
  const [note, setNote] = useState(transaction ? transaction.note || '' : '');

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const isTransfer = type === 'transfer';

  function validate() {
    const newErrors = {};
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
    }
    if (!type) {
      newErrors.type = 'Please select a type';
    }
    if (!isTransfer && !categoryId) {
      newErrors.categoryId = 'Please select a category';
    }
    if (!accountId) {
      newErrors.accountId = isTransfer ? 'Please select source account' : 'Please select a bank account';
    }
    if (isTransfer && !toAccountId) {
      newErrors.toAccountId = 'Please select destination account';
    }
    if (isTransfer && accountId && toAccountId && String(accountId) === String(toAccountId)) {
      newErrors.toAccountId = 'Source and destination accounts must be different';
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

    setSubmitting(true);
    try {
      if (isTransfer) {
        // Single transfer transaction
        await createTransaction({
          amount: parseFloat(amount),
          type: 'transfer',
          account_id: Number(accountId),
          to_account_id: Number(toAccountId),
          date,
          note: note.trim(),
        });
      } else {
        const payload = {
          amount: parseFloat(amount),
          type,
          category_id: Number(categoryId),
          account_id: Number(accountId),
          date,
          note: note.trim(),
        };

        if (isEdit) {
          await updateTransaction(transaction.id, payload);
        } else {
          await createTransaction(payload);
        }
      }

      onSaved();
      onClose();
      checkBudgetAfterMutation();
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
              <option value="transfer">Transfer</option>
            </select>
            {errors.type && <span className="field-error">{errors.type}</span>}
          </div>

          {/* Category - hidden for transfers */}
          {!isTransfer && (
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
          )}

          {/* Source Account */}
          <div className="form-field">
            <label htmlFor="txn-account">
              {isTransfer ? 'From Account' : 'Bank Account'}
            </label>
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

          {/* Destination Account - only for transfers */}
          {isTransfer && (
            <div className="form-field">
              <label htmlFor="txn-to-account">To Account</label>
              <select
                id="txn-to-account"
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
              >
                <option value="">-- Select destination account --</option>
                {accounts
                  .filter((acc) => String(acc.id) !== String(accountId))
                  .map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
              </select>
              {errors.toAccountId && <span className="field-error">{errors.toAccountId}</span>}
            </div>
          )}

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

          {/* Transfer info */}
          {isTransfer && (
            <p className="transfer-info">
              Transfers are not counted as expenses in your budget.
            </p>
          )}

          {/* Submit error */}
          {submitError && <p className="form-submit-error">{submitError}</p>}

          {/* Actions */}
          <div className="form-actions">
            <button type="button" className="form-cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="form-save-btn" disabled={submitting}>
              {submitting ? 'Saving...' : isTransfer ? 'Transfer' : isEdit ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
