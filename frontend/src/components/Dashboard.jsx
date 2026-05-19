import { useState, useEffect } from 'react';
import { fetchDashboard } from '../services/api';
import { checkAndNotify } from '../services/notifications';

function getCurrentMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CATEGORY_COLORS = [
  '#8b7345', '#c4a96a', '#6b6050', '#a68b5b', '#d4b87a',
  '#5a8a5e', '#9c7a4f', '#7a6b55', '#b89e6a', '#4a6b4a',
];

function DonutChart({ breakdown, totalExpenses }) {
  const size = 180;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let cumulativePercent = 0;
  const segments = breakdown.map((cat, i) => {
    const percent = totalExpenses > 0 ? (cat.total / totalExpenses) * 100 : 0;
    const offset = circumference * (1 - cumulativePercent / 100);
    const length = circumference * (percent / 100);
    cumulativePercent += percent;
    return {
      ...cat,
      percent,
      offset: circumference - (circumference * (cumulativePercent - percent) / 100),
      length,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    };
  });

  // Build stroke-dasharray segments
  let accumulatedOffset = 0;

  return (
    <div className="donut-chart-container">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-svg">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {segments.map((seg, i) => {
          const dashArray = `${seg.length} ${circumference - seg.length}`;
          const dashOffset = circumference - accumulatedOffset;
          accumulatedOffset += seg.length;
          return (
            <circle
              key={seg.categoryId || i}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${center} ${center})`}
            />
          );
        })}
        {/* Center text */}
        <text x={center} y={center - 6} textAnchor="middle" className="donut-center-percent">
          {totalExpenses > 0 ? '100%' : '0%'}
        </text>
      </svg>
    </div>
  );
}

export default function Dashboard({ onAddTransaction }) {
  const [period, setPeriod] = useState(getCurrentMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchDashboard(period.month, period.year)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          checkAndNotify({
            month: period.month,
            year: period.year,
            remainingBudget: result.remainingBudget,
            budgetAmount: result.budgetAmount,
            alertThresholdPercent: result.alertThresholdPercent,
            aboveThreshold: result.isAboveThreshold,
            isOverBudget: result.isOverBudget,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [period.month, period.year]);

  function goToPrevMonth() {
    setPeriod((prev) => {
      if (prev.month === 1) return { month: 12, year: prev.year - 1 };
      return { month: prev.month - 1, year: prev.year };
    });
  }

  function goToNextMonth() {
    setPeriod((prev) => {
      if (prev.month === 12) return { month: 1, year: prev.year + 1 };
      return { month: prev.month + 1, year: prev.year };
    });
  }

  function getDaysLeftInMonth() {
    const now = new Date();
    const lastDay = new Date(period.year, period.month, 0).getDate();
    if (period.month === now.getMonth() + 1 && period.year === now.getFullYear()) {
      return lastDay - now.getDate();
    }
    return 0;
  }

  function getPacingStatus() {
    if (!data) return { label: 'N/A', className: '' };
    const { budgetUtilizationPercent } = data;
    const now = new Date();
    const lastDay = new Date(period.year, period.month, 0).getDate();
    const dayOfMonth = now.getDate();
    const expectedPercent = (dayOfMonth / lastDay) * 100;

    if (budgetUtilizationPercent <= expectedPercent) {
      return { label: 'On Track', className: 'pacing-good' };
    } else if (budgetUtilizationPercent <= expectedPercent * 1.2) {
      return { label: 'Slightly Over', className: 'pacing-warning' };
    }
    return { label: 'Over Pace', className: 'pacing-danger' };
  }

  if (loading) {
    return <div className="dashboard-loading">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="dashboard-error">Error: {error}</div>;
  }

  if (!data) return null;

  const {
    totalIncome,
    totalExpenses,
    budgetAmount,
    remainingBudget,
    budgetUtilizationPercent,
    alertThresholdPercent,
    isOverBudget,
    isAboveThreshold,
    categoryBreakdown,
    accounts,
    totalBalance,
  } = data;

  const fillWidth = Math.min(budgetUtilizationPercent, 100);
  const daysLeft = getDaysLeftInMonth();
  const pacing = getPacingStatus();
  const maxCategoryTotal = categoryBreakdown && categoryBreakdown.length > 0
    ? Math.max(...categoryBreakdown.map((c) => c.total))
    : 0;

  return (
    <div className="dashboard">
      {/* Month Selector */}
      <div className="dashboard-month-selector">
        <button className="month-prev-link" onClick={goToPrevMonth}>
          &lt; Previous Month
        </button>
        <div className="month-center">
          <button className="month-nav-btn" onClick={goToPrevMonth} aria-label="Previous month">
            &#8249;
          </button>
          <span className="month-label">
            {MONTH_NAMES[period.month - 1]} {period.year}
          </span>
          <button className="month-nav-btn" onClick={goToNextMonth} aria-label="Next month">
            &#8250;
          </button>
        </div>
        <button className="month-next-link" onClick={goToNextMonth}>
          Next Month &gt;
        </button>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card card-income">
          <div className="card-top">
            <span className="card-label">INCOME</span>
          </div>
          <span className="card-value">{formatCurrency(totalIncome)}</span>
          <span className="card-icon">💰</span>
        </div>
        <div className="summary-card card-expenses">
          <div className="card-top">
            <span className="card-label">EXPENSES</span>
            {isOverBudget && <span className="card-badge badge-danger">▲ Action Needed</span>}
            {!isOverBudget && isAboveThreshold && <span className="card-badge badge-warning">▲ Action Needed</span>}
          </div>
          <span className="card-value">{formatCurrency(totalExpenses)}</span>
          <span className="card-icon">🛒</span>
        </div>
        <div className="summary-card card-remaining">
          <div className="card-top">
            <span className="card-label">REMAINING BUDGET</span>
          </div>
          <span className="card-value">{formatCurrency(remainingBudget)}</span>
          <span className="card-icon">🎯</span>
        </div>
        <div className="summary-card card-utilization">
          <div className="card-top">
            <span className="card-label">BUDGET USED</span>
          </div>
          <span className="card-value">{budgetUtilizationPercent.toFixed(1)}%</span>
          <div className="mini-donut">
            <svg width="48" height="48" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="18" fill="none" stroke="#e2e8f0" strokeWidth="6" />
              <circle
                cx="24" cy="24" r="18" fill="none"
                stroke="#7c3aed"
                strokeWidth="6"
                strokeDasharray={`${(fillWidth / 100) * 113.1} 113.1`}
                strokeDashoffset="28.3"
                strokeLinecap="round"
                transform="rotate(-90 24 24)"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Budget Progress Bar */}
      <div className="budget-progress-section">
        <div className="budget-progress-header">
          <span>Budget: {formatCurrency(budgetAmount)}</span>
          <span>{budgetUtilizationPercent.toFixed(1)}% used</span>
        </div>
        <div className="progress-bar" role="progressbar" aria-valuenow={fillWidth} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={`progress-fill${isOverBudget ? ' over-budget' : isAboveThreshold ? ' below-threshold' : ''}`}
            style={{ width: `${fillWidth}%` }}
          />
        </div>
        <div className="pacing-info">
          Pacing score: <span className={pacing.className}>{pacing.label}</span>
          {' '}({budgetUtilizationPercent.toFixed(1)}% used / {daysLeft} days left in {MONTH_NAMES[period.month - 1]})
        </div>
        {isOverBudget && (
          <div className="over-budget-indicator" role="alert">
            🚨 Over Budget! You have exceeded your monthly budget.
          </div>
        )}
      </div>

      {/* Two Column: Accounts + Spending Breakdown */}
      <div className="dashboard-grid">
        {/* Connected Accounts */}
        <div className="accounts-card">
          <h3 className="card-section-title">Your Connected Accounts</h3>
          <div className="accounts-grid">
            {accounts && accounts.length > 0 ? (
              accounts.map((account) => (
                <div key={account.id} className="account-tile">
                  <div className="account-tile-icon">🏦</div>
                  <div className="account-tile-name">{account.name}</div>
                  <div className={`account-tile-balance${account.balance < 0 ? ' negative' : ''}`}>
                    {formatCurrency(account.balance)}
                  </div>
                </div>
              ))
            ) : (
              <p className="no-data-text">No accounts added yet.</p>
            )}
          </div>
          {accounts && accounts.length > 0 && (
            <div className="accounts-footer">
              <div className="total-net-balance">
                <span>Total Net Balance:</span>
                <span className="total-balance-value">{formatCurrency(totalBalance)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Spending Breakdown */}
        <div className="breakdown-card">
          <h3 className="card-section-title">Spending Breakdown</h3>
          {categoryBreakdown && categoryBreakdown.length > 0 ? (
            <div className="breakdown-content">
              <DonutChart breakdown={categoryBreakdown} totalExpenses={totalExpenses} />
              <div className="breakdown-legend">
                {categoryBreakdown.map((cat, i) => (
                  <div key={cat.categoryId} className="legend-item">
                    <span className="legend-dot" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                    <span className="legend-name">{cat.name}</span>
                    <span className="legend-amount">{formatCurrency(cat.total)}</span>
                    <div className="legend-bar-track">
                      <div
                        className="legend-bar-fill"
                        style={{
                          width: maxCategoryTotal > 0 ? `${(cat.total / maxCategoryTotal) * 100}%` : '0%',
                          background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="no-data-text">No expenses this month.</p>
          )}
        </div>
      </div>
    </div>
  );
}
