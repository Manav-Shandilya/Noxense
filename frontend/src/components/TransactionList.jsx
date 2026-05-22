import { useState, useEffect } from 'react';
import { fetchTransactions, deleteTransaction } from '../services/api';
import { checkBudgetAfterMutation } from '../services/notifications';

function getCurrentMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function groupByDate(transactions) {
  const groups = {};
  for (const txn of transactions) {
    const key = txn.date;
    if (!groups[key]) groups[key] = [];
    groups[key].push(txn);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}

export default function TransactionList({ month, year, categories, initialTransactions, setTransactions: setParentTransactions, onEdit, onDeleted, refreshKey }) {
  const currentMonth = getCurrentMonth();
  const isCurrentMonth = month === currentMonth.month && year === currentMonth.year;

  const [transactions, setTransactions] = useState(
    isCurrentMonth && initialTransactions ? initialTransactions : []
  );
  const [loading, setLoading] = useState(
    !(isCurrentMonth && initialTransactions && initialTransactions.length >= 0)
  );
  const [error, setError] = useState(null);

  const excludedCategoryIds = new Set(
    (categories || [])
      .filter((c) => c.excluded_from_budget)
      .map((c) => c.id)
  );

  useEffect(() => {
    // If current month and we have initial data, use it
    if (isCurrentMonth && initialTransactions) {
      setTransactions(initialTransactions);
      setLoading(false);
      return;
    }

    // Otherwise fetch
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchTransactions(month, year)
      .then((txns) => {
        if (!cancelled) {
          setTransactions(txns);
          if (isCurrentMonth && setParentTransactions) {
            setParentTransactions(txns);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [month, year, refreshKey]);

  // Sync with parent when initialTransactions changes (e.g., after refresh)
  useEffect(() => {
    if (isCurrentMonth && initialTransactions) {
      setTransactions(initialTransactions);
      setLoading(false);
    }
  }, [initialTransactions]);

  async function handleDelete(txn) {
    const confirmed = window.confirm(
      `Delete this ${txn.type} of ${formatCurrency(txn.amount)}?`
    );
    if (!confirmed) return;

    try {
      await deleteTransaction(txn.id);
      setTransactions((prev) => prev.filter((t) => t.id !== txn.id));
      if (onDeleted) onDeleted();
      checkBudgetAfterMutation();
    } catch (err) {
      alert('Failed to delete transaction: ' + err.message);
    }
  }

  if (loading) {
    return <div className="transaction-list-loading">Loading transactions...</div>;
  }

  if (error) {
    return <div className="transaction-list-error">Error: {error}</div>;
  }

  if (transactions.length === 0) {
    return (
      <div className="transaction-list-empty">
        <p className="no-data-text">No transactions this month.</p>
      </div>
    );
  }

  const grouped = groupByDate(transactions);

  return (
    <div className="transaction-list">
      {grouped.map(([date, txns]) => (
        <div key={date} className="transaction-date-group">
          <h4 className="transaction-date-header">{formatDate(date)}</h4>
          <ul className="transaction-items">
            {txns.map((txn) => {
              const isExcluded = excludedCategoryIds.has(txn.category_id);
              return (
              <li
                key={txn.id}
                className={`transaction-item${isExcluded ? ' excluded' : ''}`}
              >
                <div className="transaction-info">
                  <div className="transaction-primary">
                    <span className="transaction-category">{txn.categoryName}</span>
                    {isExcluded ? (
                      <span className="excluded-badge">Excluded</span>
                    ) : null}
                  </div>
                  <div className="transaction-secondary">
                    <span className="transaction-account">{txn.accountName}</span>
                    {txn.note && <span className="transaction-note">{txn.note}</span>}
                  </div>
                </div>
                <div className="transaction-right">
                  <span className={`transaction-amount ${txn.type}`}>
                    {txn.type === 'income' ? '+' : '-'}{formatCurrency(txn.amount)}
                  </span>
                  <div className="transaction-actions">
                    <button
                      className="txn-edit-btn"
                      onClick={() => onEdit(txn)}
                      aria-label={`Edit ${txn.categoryName} transaction`}
                    >
                      ✏️
                    </button>
                    <button
                      className="txn-delete-btn"
                      onClick={() => handleDelete(txn)}
                      aria-label={`Delete ${txn.categoryName} transaction`}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
