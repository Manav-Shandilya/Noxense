/**
 * Browser notification service for budget alerts.
 * Sends a notification every time spending crosses the threshold —
 * i.e. transitions from "under threshold" to "over threshold".
 * If a user deletes a transaction (dropping below) and then adds one
 * that crosses again, a new notification fires.
 */

import { fetchDashboard } from './api';

const STATE_KEY = 'expense_tracker_budget_state';

/**
 * Check if the browser supports notifications.
 */
export function isNotificationSupported() {
  return 'Notification' in window;
}

/**
 * Request notification permission from the user.
 */
export async function requestPermission() {
  if (!isNotificationSupported()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

/**
 * Get the previously stored budget state for a given month.
 */
function getPreviousState(month, year) {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.month === month && parsed.year === year) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store the current budget state for transition detection.
 */
function saveCurrentState(month, year, aboveThreshold, isOverBudget) {
  localStorage.setItem(STATE_KEY, JSON.stringify({
    month,
    year,
    aboveThreshold: aboveThreshold,
    overBudget: isOverBudget,
  }));
}

/**
 * Check budget state and send notification on threshold crossing.
 * Fires when isAboveThreshold or isOverBudget transitions false → true.
 */
export async function checkAndNotify({ month, year, remainingBudget, budgetAmount, alertThresholdPercent, aboveThreshold, isOverBudget }) {
  if (!isNotificationSupported()) return;
  if (budgetAmount <= 0) return;

  // Clean up old key format
  localStorage.removeItem('expense_tracker_last_budget_alert');

  const prev = getPreviousState(month, year);

  // Detect transitions
  const justCrossedThreshold = aboveThreshold
  const justWentOverBudget = isOverBudget

  // Always save current state for next comparison
  saveCurrentState(month, year, aboveThreshold, isOverBudget);

  // No transition happened — no notification needed
  if (!justCrossedThreshold && !justWentOverBudget) return;

  // Request permission
  const permission = await requestPermission();
  if (permission !== 'granted') return;

  // Send notification
  let title, body;
  if (justWentOverBudget) {
    title = '🚨 Over Budget!';
    body = `You have exceeded your monthly budget for ${monthName(month)} ${year}.`;
  } else {
    title = '⚠️ Budget Alert';
    body = `Your remaining budget is below ${alertThresholdPercent}% (₹${Math.round(remainingBudget)} left) for ${monthName(month)} ${year}.`;
  }

  new Notification(title, { body, icon: '/icons/icon-192.png', tag: `budget-alert-${Date.now()}` });
}

/**
 * Fetch the current month's dashboard data and run the notification check.
 * Call this after any transaction mutation (add/edit/delete) so the
 * budget state is updated immediately without waiting for dashboard tab.
 */
export async function checkBudgetAfterMutation() {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const data = await fetchDashboard(month, year);
    console.log('data = ', data);
    await checkAndNotify({
      month,
      year,
      remainingBudget: data.remainingBudget,
      budgetAmount: data.budgetAmount,
      alertThresholdPercent: data.alertThresholdPercent,
      aboveThreshold: data.isAboveThreshold,
      isOverBudget: data.isOverBudget,
    });
  } catch {
    // Silently fail — don't block the user flow for notification checks
  }
}

function monthName(month) {
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month - 1] || '';
}
