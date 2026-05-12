import { useState, useEffect } from 'react';
import { fetchBudget, setBudget, fetchSettings, updateSettings } from '../services/api';

export default function BudgetSettings({ onClose, onChanged }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  // Budget state
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetError, setBudgetError] = useState(null);
  const [budgetSuccess, setBudgetSuccess] = useState(false);

  // Settings state
  const [threshold, setThreshold] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  useEffect(() => {
    loadBudget();
  }, [month, year]);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadBudget() {
    setBudgetLoading(true);
    setBudgetError(null);
    setBudgetSuccess(false);
    try {
      const data = await fetchBudget(month, year);
      setBudgetAmount(data.budget.amount != null ? String(data.budget.amount) : '');
    } catch (err) {
      setBudgetError(err.message);
    } finally {
      setBudgetLoading(false);
    }
  }

  async function loadSettings() {
    setSettingsLoading(true);
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      const data = await fetchSettings();
      setThreshold(data.alert_threshold_percent != null ? String(data.alert_threshold_percent) : '20');
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleSaveBudget(e) {
    e.preventDefault();
    const amount = parseFloat(budgetAmount);
    if (isNaN(amount) || amount < 0) {
      setBudgetError('Please enter a valid budget amount (0 or more)');
      return;
    }
    setBudgetSaving(true);
    setBudgetError(null);
    setBudgetSuccess(false);
    try {
      await setBudget({ month, year, amount });
      setBudgetSuccess(true);
      if (onChanged) onChanged();
    } catch (err) {
      setBudgetError(err.message);
    } finally {
      setBudgetSaving(false);
    }
  }

  async function handleSaveThreshold(e) {
    e.preventDefault();
    const value = parseInt(threshold, 10);
    if (isNaN(value) || value < 0 || value > 100) {
      setSettingsError('Please enter a value between 0 and 100');
      return;
    }
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      await updateSettings({ alert_threshold_percent: value });
      setSettingsSuccess(true);
      if (onChanged) onChanged();
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSettingsSaving(false);
    }
  }

  function prevMonth() {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  }

  function nextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  }

  const monthLabel = new Date(year, month - 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

  useEffect(() => {
    console.log('Monthly Buge - ', budgetAmount);
  }, [budgetAmount]);

  return (
    <div className="budget-settings">
      <div className="budget-settings-header">
        <h2>Budget Settings</h2>
        {onClose && (
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      {/* Monthly Budget Section */}
      <div className="budget-settings-section">
        <h3 className="budget-settings-section-title">Monthly Budget</h3>

        <div className="month-selector">
          <button className="month-nav-btn" onClick={prevMonth} aria-label="Previous month">
            ‹
          </button>
          <span className="month-label">{monthLabel}</span>
          <button className="month-nav-btn" onClick={nextMonth} aria-label="Next month">
            ›
          </button>
        </div>

        <form className="budget-settings-form" onSubmit={handleSaveBudget}>
          <div className="form-field">
            <label htmlFor="budget-amount">Budget Amount</label>
            <input
              id="budget-amount"
              type="number"
              placeholder="Enter monthly budget"
              value={budgetAmount}
              onChange={(e) => {
                setBudgetAmount(e.target.value);
                setBudgetSuccess(false);
              }}
              disabled={budgetLoading || budgetSaving}
              step="0.01"
              min="0"
            />
          </div>
          <button
            type="submit"
            className="budget-settings-save-btn"
            disabled={budgetLoading || budgetSaving}
          >
            {budgetSaving ? 'Saving...' : 'Save Budget'}
          </button>
          {budgetError && <p className="budget-settings-error">{budgetError}</p>}
          {budgetSuccess && <p className="budget-settings-success">Budget saved successfully!</p>}
        </form>
      </div>

      {/* Alert Threshold Section */}
      <div className="budget-settings-section">
        <h3 className="budget-settings-section-title">Alert Threshold</h3>
        <p className="budget-settings-description">
          Get alerted when your remaining budget falls below this percentage.
        </p>

        <form className="budget-settings-form" onSubmit={handleSaveThreshold}>
          <div className="form-field">
            <label htmlFor="alert-threshold">Threshold Percentage (%)</label>
            <input
              id="alert-threshold"
              type="number"
              placeholder="e.g. 20"
              value={threshold}
              onChange={(e) => {
                setThreshold(e.target.value);
                setSettingsSuccess(false);
              }}
              disabled={settingsLoading || settingsSaving}
              min="0"
              max="100"
              step="1"
            />
          </div>
          <button
            type="submit"
            className="budget-settings-save-btn"
            disabled={settingsLoading || settingsSaving}
          >
            {settingsSaving ? 'Saving...' : 'Save Threshold'}
          </button>
          {settingsError && <p className="budget-settings-error">{settingsError}</p>}
          {settingsSuccess && <p className="budget-settings-success">Threshold saved successfully!</p>}
        </form>
      </div>
    </div>
  );
}
