import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src/index.js';

const PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const AUTH_SECRET = 'test-secret-key-for-hmac';

// In-memory D1 mock for dashboard tests
function createMockDB() {
  let categories = [
    { id: 1, name: 'Food', icon: null, excluded_from_budget: 0, created_at: '2024-01-01' },
    { id: 2, name: 'Transport', icon: null, excluded_from_budget: 0, created_at: '2024-01-01' },
    { id: 3, name: 'Investments', icon: null, excluded_from_budget: 1, created_at: '2024-01-01' },
    { id: 4, name: 'Salary', icon: null, excluded_from_budget: 0, created_at: '2024-01-01' },
  ];
  let accounts = [
    { id: 1, name: 'Savings', initial_balance: 10000, created_at: '2024-01-01' },
    { id: 2, name: 'Checking', initial_balance: 5000, created_at: '2024-01-01' },
  ];
  let transactions = [];
  let budgets = [];
  let settings = { id: 1, alert_threshold_percent: 20 };
  let nextTransactionId = 1;
  let nextBudgetId = 1;

  return {
    prepare(sql) {
      return {
        bind(...params) {
          this._params = params;
          return this;
        },
        async all() {
          // Accounts list
          if (sql.includes('FROM accounts ORDER BY id')) {
            return { results: accounts };
          }
          // Category breakdown
          if (sql.includes('GROUP BY t.category_id')) {
            const datePrefix = this._params[0];
            const monthTransactions = transactions.filter(
              t => t.type === 'expense' && t.date.startsWith(datePrefix.replace('%', ''))
            );
            const breakdown = {};
            for (const t of monthTransactions) {
              const cat = categories.find(c => c.id === t.category_id);
              if (!cat) continue;
              if (!breakdown[t.category_id]) {
                breakdown[t.category_id] = { categoryId: t.category_id, name: cat.name, total: 0 };
              }
              breakdown[t.category_id].total += t.amount;
            }
            const results = Object.values(breakdown).sort((a, b) => b.total - a.total);
            return { results };
          }
          return { results: [] };
        },
        async first() {
          // Total income for month
          if (sql.includes("type = 'income' AND date LIKE")) {
            const datePrefix = this._params[0];
            const total = transactions
              .filter(t => t.type === 'income' && t.date.startsWith(datePrefix.replace('%', '')))
              .reduce((sum, t) => sum + t.amount, 0);
            return { total };
          }
          // Total expenses for month
          if (sql.includes("type = 'expense' AND date LIKE") && !sql.includes('JOIN')) {
            const datePrefix = this._params[0];
            const total = transactions
              .filter(t => t.type === 'expense' && t.date.startsWith(datePrefix.replace('%', '')))
              .reduce((sum, t) => sum + t.amount, 0);
            return { total };
          }
          // Non-excluded expenses for month
          if (sql.includes("t.type = 'expense'") && sql.includes('excluded_from_budget = 0')) {
            const datePrefix = this._params[0];
            const total = transactions
              .filter(t => {
                if (t.type !== 'expense') return false;
                if (!t.date.startsWith(datePrefix.replace('%', ''))) return false;
                const cat = categories.find(c => c.id === t.category_id);
                return cat && cat.excluded_from_budget === 0;
              })
              .reduce((sum, t) => sum + t.amount, 0);
            return { total };
          }
          // Budget for exact month/year
          if (sql.includes('FROM budgets WHERE month = ? AND year = ?')) {
            const month = this._params[0];
            const year = this._params[1];
            const b = budgets.find(b => b.month === month && b.year === year);
            return b ? { amount: b.amount } : null;
          }
          // Budget carry-forward
          if (sql.includes('FROM budgets') && sql.includes('ORDER BY year DESC, month DESC')) {
            const yearNum = this._params[0];
            const yearNum2 = this._params[1];
            const monthNum = this._params[2];
            const previous = budgets
              .filter(b => b.year < yearNum || (b.year === yearNum2 && b.month < monthNum))
              .sort((a, b) => b.year - a.year || b.month - a.month);
            return previous[0] ? { amount: previous[0].amount } : null;
          }
          // Settings
          if (sql.includes('FROM settings WHERE id = 1')) {
            return settings;
          }
          // Account income
          if (sql.includes("account_id = ?") && sql.includes("type = 'income'")) {
            const accountId = this._params[0];
            const total = transactions
              .filter(t => t.account_id === accountId && t.type === 'income')
              .reduce((sum, t) => sum + t.amount, 0);
            return { total };
          }
          // Account expenses
          if (sql.includes("account_id = ?") && sql.includes("type = 'expense'")) {
            const accountId = this._params[0];
            const total = transactions
              .filter(t => t.account_id === accountId && t.type === 'expense')
              .reduce((sum, t) => sum + t.amount, 0);
            return { total };
          }
          return null;
        },
        async run() {
          return {};
        },
      };
    },
    _addTransaction(t) {
      transactions.push({ id: nextTransactionId++, ...t });
    },
    _addBudget(b) {
      budgets.push({ id: nextBudgetId++, ...b });
    },
    _setSettings(s) {
      settings = { id: 1, ...s };
    },
    _setCategories(cats) {
      categories = cats;
    },
    _setAccounts(accts) {
      accounts = accts;
    },
    _reset() {
      categories = [
        { id: 1, name: 'Food', icon: null, excluded_from_budget: 0, created_at: '2024-01-01' },
        { id: 2, name: 'Transport', icon: null, excluded_from_budget: 0, created_at: '2024-01-01' },
        { id: 3, name: 'Investments', icon: null, excluded_from_budget: 1, created_at: '2024-01-01' },
        { id: 4, name: 'Salary', icon: null, excluded_from_budget: 0, created_at: '2024-01-01' },
      ];
      accounts = [
        { id: 1, name: 'Savings', initial_balance: 10000, created_at: '2024-01-01' },
        { id: 2, name: 'Checking', initial_balance: 5000, created_at: '2024-01-01' },
      ];
      transactions = [];
      budgets = [];
      settings = { id: 1, alert_threshold_percent: 20 };
      nextTransactionId = 1;
      nextBudgetId = 1;
    },
  };
}

let validToken;
let mockDB;
let env;

function makeRequest(path, options = {}) {
  const { method = 'GET', body, headers = {} } = options;
  const url = `http://localhost${path}`;
  const init = { method, headers: new Headers(headers) };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers.set('Content-Type', 'application/json');
  }
  return new Request(url, init);
}

function authRequest(path, options = {}) {
  const headers = { ...options.headers, Authorization: `Bearer ${validToken}` };
  return makeRequest(path, { ...options, headers });
}

async function getJson(response) {
  return response.json();
}

beforeAll(async () => {
  mockDB = createMockDB();
  env = { PIN_HASH, AUTH_SECRET, DB: mockDB };

  const req = makeRequest('/api/login', { method: 'POST', body: { pin: '1234' } });
  const res = await worker.fetch(req, env);
  const data = await getJson(res);
  validToken = data.token;
});

beforeEach(() => {
  mockDB._reset();
});

describe('GET /api/dashboard', () => {
  it('returns zeros for a month with no transactions and no budget', async () => {
    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.month).toBe(6);
    expect(data.year).toBe(2024);
    expect(data.totalIncome).toBe(0);
    expect(data.totalExpenses).toBe(0);
    expect(data.budgetAmount).toBe(0);
    expect(data.remainingBudget).toBe(0);
    expect(data.budgetUtilizationPercent).toBe(0);
    expect(data.isOverBudget).toBe(true); // remainingBudget (0) <= 0
    expect(data.isBelowThreshold).toBe(false); // 0 < 0 * 0.2 = 0 < 0 = false
    expect(data.categoryBreakdown).toEqual([]);
    expect(data.totalBalance).toBe(15000); // 10000 + 5000
  });

  it('computes totalIncome and totalExpenses correctly', async () => {
    mockDB._addTransaction({ type: 'income', amount: 5000, category_id: 4, account_id: 1, date: '2024-06-01', note: '' });
    mockDB._addTransaction({ type: 'income', amount: 3000, category_id: 4, account_id: 2, date: '2024-06-15', note: '' });
    mockDB._addTransaction({ type: 'expense', amount: 1000, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });
    mockDB._addTransaction({ type: 'expense', amount: 500, category_id: 2, account_id: 1, date: '2024-06-10', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.totalIncome).toBe(8000);
    expect(data.totalExpenses).toBe(1500);
  });

  it('uses budget for the exact month when set', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 5000 });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.budgetAmount).toBe(5000);
  });

  it('carries forward budget from most recent previous month', async () => {
    mockDB._addBudget({ month: 3, year: 2024, amount: 4000 });
    mockDB._addBudget({ month: 5, year: 2024, amount: 6000 });

    const req = authRequest('/api/dashboard?month=7&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.budgetAmount).toBe(6000);
  });

  it('computes remainingBudget excluding excluded categories', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 5000 });
    // Non-excluded expense (Food)
    mockDB._addTransaction({ type: 'expense', amount: 1000, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });
    // Excluded expense (Investments)
    mockDB._addTransaction({ type: 'expense', amount: 2000, category_id: 3, account_id: 1, date: '2024-06-10', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    // remainingBudget = 5000 - 1000 (only non-excluded) = 4000
    expect(data.remainingBudget).toBe(4000);
    // totalExpenses includes all expenses
    expect(data.totalExpenses).toBe(3000);
  });

  it('computes budgetUtilizationPercent correctly', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 5000 });
    mockDB._addTransaction({ type: 'expense', amount: 2500, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    // utilization = ((5000 - 2500) / 5000) * 100 ... wait no
    // utilization = ((budgetAmount - remainingBudget) / budgetAmount) * 100
    // remainingBudget = 5000 - 2500 = 2500
    // utilization = ((5000 - 2500) / 5000) * 100 = 50
    expect(data.budgetUtilizationPercent).toBe(50);
  });

  it('returns 0 for budgetUtilizationPercent when no budget', async () => {
    mockDB._addTransaction({ type: 'expense', amount: 1000, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.budgetUtilizationPercent).toBe(0);
  });

  it('sets isOverBudget true when remainingBudget <= 0', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 1000 });
    mockDB._addTransaction({ type: 'expense', amount: 1200, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.remainingBudget).toBe(-200);
    expect(data.isOverBudget).toBe(true);
  });

  it('sets isOverBudget false when remainingBudget > 0', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 5000 });
    mockDB._addTransaction({ type: 'expense', amount: 1000, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.remainingBudget).toBe(4000);
    expect(data.isOverBudget).toBe(false);
  });

  it('sets isBelowThreshold correctly based on alert_threshold_percent', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 5000 });
    // threshold is 20%, so alert when remaining < 5000 * 0.2 = 1000
    mockDB._addTransaction({ type: 'expense', amount: 4200, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    // remaining = 5000 - 4200 = 800
    // threshold = 5000 * 0.2 = 1000
    // 800 < 1000 => true
    expect(data.remainingBudget).toBe(800);
    expect(data.isBelowThreshold).toBe(true);
  });

  it('sets isBelowThreshold false when remaining is above threshold', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 5000 });
    mockDB._addTransaction({ type: 'expense', amount: 2000, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    // remaining = 5000 - 2000 = 3000
    // threshold = 5000 * 0.2 = 1000
    // 3000 < 1000 => false
    expect(data.remainingBudget).toBe(3000);
    expect(data.isBelowThreshold).toBe(false);
  });

  it('returns correct categoryBreakdown', async () => {
    mockDB._addTransaction({ type: 'expense', amount: 1000, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });
    mockDB._addTransaction({ type: 'expense', amount: 500, category_id: 1, account_id: 1, date: '2024-06-10', note: '' });
    mockDB._addTransaction({ type: 'expense', amount: 300, category_id: 2, account_id: 1, date: '2024-06-15', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.categoryBreakdown).toHaveLength(2);
    // Sorted by total DESC
    expect(data.categoryBreakdown[0]).toEqual({ categoryId: 1, name: 'Food', total: 1500 });
    expect(data.categoryBreakdown[1]).toEqual({ categoryId: 2, name: 'Transport', total: 300 });
  });

  it('returns accounts with correct balances', async () => {
    // Account 1 (Savings): initial 10000, +5000 income, -1000 expense = 14000
    mockDB._addTransaction({ type: 'income', amount: 5000, category_id: 4, account_id: 1, date: '2024-06-01', note: '' });
    mockDB._addTransaction({ type: 'expense', amount: 1000, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });
    // Account 2 (Checking): initial 5000, no transactions = 5000

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.accounts).toHaveLength(2);
    expect(data.accounts[0]).toEqual({ id: 1, name: 'Savings', balance: 14000 });
    expect(data.accounts[1]).toEqual({ id: 2, name: 'Checking', balance: 5000 });
  });

  it('computes totalBalance as sum of all account balances', async () => {
    mockDB._addTransaction({ type: 'income', amount: 5000, category_id: 4, account_id: 1, date: '2024-06-01', note: '' });
    mockDB._addTransaction({ type: 'expense', amount: 1000, category_id: 1, account_id: 2, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    // Account 1: 10000 + 5000 = 15000
    // Account 2: 5000 - 1000 = 4000
    // Total: 19000
    expect(data.totalBalance).toBe(19000);
  });

  it('returns alertThresholdPercent from settings', async () => {
    mockDB._setSettings({ alert_threshold_percent: 30 });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.alertThresholdPercent).toBe(30);
  });

  it('returns 400 when month is missing', async () => {
    const req = authRequest('/api/dashboard?year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month and year query params are required');
  });

  it('returns 400 when year is missing', async () => {
    const req = authRequest('/api/dashboard?month=6');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month and year query params are required');
  });

  it('returns 400 for invalid month', async () => {
    const req = authRequest('/api/dashboard?month=13&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month must be between 1 and 12');
  });

  it('requires authentication', async () => {
    const req = makeRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it('does not include income transactions in categoryBreakdown', async () => {
    mockDB._addTransaction({ type: 'income', amount: 5000, category_id: 4, account_id: 1, date: '2024-06-01', note: '' });
    mockDB._addTransaction({ type: 'expense', amount: 1000, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    // Only expense categories in breakdown
    expect(data.categoryBreakdown).toHaveLength(1);
    expect(data.categoryBreakdown[0].name).toBe('Food');
  });

  it('account balances include transactions from all months (not just queried month)', async () => {
    // Transaction from a different month
    mockDB._addTransaction({ type: 'income', amount: 2000, category_id: 4, account_id: 1, date: '2024-05-01', note: '' });
    // Transaction from queried month
    mockDB._addTransaction({ type: 'expense', amount: 500, category_id: 1, account_id: 1, date: '2024-06-05', note: '' });

    const req = authRequest('/api/dashboard?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    // Account 1: 10000 + 2000 - 500 = 11500
    expect(data.accounts[0].balance).toBe(11500);
  });
});
