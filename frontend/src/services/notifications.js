/**
 * Browser notification service for budget alerts.
 * Requests permission on first threshold breach and sends notifications
 * when remaining budget falls below the configured alert threshold.
 */

const NOTIFICATION_KEY = 'expense_tracker_last_budget_alert';

/**
 * Check if the browser supports notifications.
 */
export function isNotificationSupported() {
  return 'Notification' in window;
}

/**
 * Request notification permission from the user.
 * Returns the permission state: 'granted', 'denied', or 'default'.
 */
export async function requestPermission() {
  if (!isNotificationSupported()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

/**
 * Send a budget alert notification if conditions are met:
 * - Notifications are supported
 * - Permission is granted (or will be requested)
 * - The alert hasn't already been sent for this month/year
 *
 * @param {object} params
 * @param {number} params.month - Current month (1-12)
 * @param {number} params.year - Current year
 * @param {number} params.remainingBudget - Remaining budget amount
 * @param {number} params.budgetAmount - Total budget amount
 * @param {number} params.alertThresholdPercent - Threshold percentage
 * @param {boolean} params.isBelowThreshold - Whether budget is below threshold
 * @param {boolean} params.isOverBudget - Whether budget is exceeded
 */
export async function checkAndNotify({ month, year, remainingBudget, budgetAmount, alertThresholdPercent, isBelowThreshold, isOverBudget }) {
  if (!isNotificationSupported()) return;
  if (!isBelowThreshold && !isOverBudget) return;
  if (budgetAmount <= 0) return;

  // Avoid duplicate notifications for the same month
  const alertKey = `${year}-${month}`;
  const lastAlert = localStorage.getItem(NOTIFICATION_KEY);
  if (lastAlert === alertKey) return;

  // Request permission on first breach
  const permission = await requestPermission();
  if (permission !== 'granted') return;

  // Build notification message
  let title, body;
  if (isOverBudget) {
    title = '🚨 Over Budget!';
    body = `You have exceeded your monthly budget for ${monthName(month)} ${year}.`;
  } else {
    title = '⚠️ Budget Alert';
    body = `Your remaining budget is below ${alertThresholdPercent}% (₹${Math.round(remainingBudget)} left) for ${monthName(month)} ${year}.`;
  }

  new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'budget-alert' });

  // Mark as notified for this month
  localStorage.setItem(NOTIFICATION_KEY, alertKey);
}

function monthName(month) {
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month - 1] || '';
}
