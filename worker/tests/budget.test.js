import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src/index.js';

const PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const AUTH_SECRET = 'test-secret-key-for-hmac';

// In-memory D1 mock for budgets and settings
function createMockDB() {
  let budgets = [];
  let settings = { id: 1, alert_threshold_percent: 20 };
  let nextBudgetId = 1;

  return {
    prepare(sql) {
      return {
        bind(...params) {
          this._params = params;
          return this;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          // GET budget for exact month/year
          if (sql.includes('FROM budgets WHERE month = ? AND year = ?') && !sql.includes('OR')) {
            const month = this._params[0];
            const year = this._params[1];
            return budgets.find(b => b.month === month && b.year === year) || null;
          }
          // Carry-forward: find most recent previous budget
          if (sql.includes('FROM budgets') && sql.includes('ORDER BY year DESC, month DESC')) {
            const yearNum = this._params[0];
            const yearNum2 = this._params[1];
            const monthNum = this._params[2];
            const previous = budgets
              .filter(b => b.year < yearNum || (b.year === yearNum2 && b.month < monthNum))
              .sort((a, b) => b.year - a.year || b.month - a.month);
            return previous[0] || null;
          }
          // GET settings
          if (sql.includes('FROM settings WHERE id = 1')) {
            return settings;
          }
          return null;
        },
        async run() {
          // INSERT OR REPLACE budget
          if (sql.includes('INSERT OR REPLACE INTO budgets')) {
            const month = this._params[0];
            const year = this._params[1];
            const amount = this._params[2];
            const existing = budgets.find(b => b.month === month && b.year === year);
            if (existing) {
              existing.amount = amount;
            } else {
              budgets.push({ id: nextBudgetId++, month, year, amount, created_at: '2024-01-01 00:00:00' });
            }
            return {};
          }
          // INSERT OR REPLACE settings
          if (sql.includes('INSERT OR REPLACE INTO settings')) {
            const threshold = this._params[0];
            settings = { id: 1, alert_threshold_percent: threshold };
            return {};
          }
          return {};
        },
      };
    },
    _getBudgets() { return budgets; },
    _getSettings() { return settings; },
    _addBudget(b) {
      budgets.push({ id: nextBudgetId++, ...b, created_at: '2024-01-01 00:00:00' });
    },
    _reset() {
      budgets = [];
      settings = { id: 1, alert_threshold_percent: 20 };
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

describe('GET /api/budgets', () => {
  it('returns budget for the exact month/year', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 5000 });
    const req = authRequest('/api/budgets?month=6&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.budget).not.toBeNull();
    expect(data.budget.month).toBe(6);
    expect(data.budget.year).toBe(2024);
    expect(data.budget.amount).toBe(5000);
  });

  it('carries forward from most recent previous month when no budget set', async () => {
    mockDB._addBudget({ month: 3, year: 2024, amount: 4000 });
    mockDB._addBudget({ month: 5, year: 2024, amount: 6000 });
    const req = authRequest('/api/budgets?month=7&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.budget).not.toBeNull();
    expect(data.budget.month).toBe(5);
    expect(data.budget.year).toBe(2024);
    expect(data.budget.amount).toBe(6000);
  });

  it('carries forward from previous year', async () => {
    mockDB._addBudget({ month: 11, year: 2023, amount: 3000 });
    const req = authRequest('/api/budgets?month=2&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.budget).not.toBeNull();
    expect(data.budget.month).toBe(11);
    expect(data.budget.year).toBe(2023);
    expect(data.budget.amount).toBe(3000);
  });

  it('returns null when no budget exists at all', async () => {
    const req = authRequest('/api/budgets?month=6&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.budget).toBeNull();
  });

  it('returns 400 when month is missing', async () => {
    const req = authRequest('/api/budgets?year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month and year query params are required');
  });

  it('returns 400 when year is missing', async () => {
    const req = authRequest('/api/budgets?month=6');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month and year query params are required');
  });

  it('returns 400 for invalid month', async () => {
    const req = authRequest('/api/budgets?month=13&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month must be between 1 and 12');
  });

  it('requires authentication', async () => {
    const req = makeRequest('/api/budgets?month=6&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/budgets', () => {
  it('creates a new budget for a month/year', async () => {
    const req = authRequest('/api/budgets', {
      method: 'POST',
      body: { month: 6, year: 2024, amount: 5000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.budget.month).toBe(6);
    expect(data.budget.year).toBe(2024);
    expect(data.budget.amount).toBe(5000);
  });

  it('upserts budget for existing month/year', async () => {
    mockDB._addBudget({ month: 6, year: 2024, amount: 5000 });
    const req = authRequest('/api/budgets', {
      method: 'POST',
      body: { month: 6, year: 2024, amount: 7000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.budget.amount).toBe(7000);
  });

  it('returns 400 when month is missing', async () => {
    const req = authRequest('/api/budgets', {
      method: 'POST',
      body: { year: 2024, amount: 5000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month is required');
  });

  it('returns 400 when year is missing', async () => {
    const req = authRequest('/api/budgets', {
      method: 'POST',
      body: { month: 6, amount: 5000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('year is required');
  });

  it('returns 400 when amount is missing', async () => {
    const req = authRequest('/api/budgets', {
      method: 'POST',
      body: { month: 6, year: 2024 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('amount is required');
  });

  it('returns 400 for invalid month', async () => {
    const req = authRequest('/api/budgets', {
      method: 'POST',
      body: { month: 0, year: 2024, amount: 5000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month must be between 1 and 12');
  });

  it('returns 400 for negative amount', async () => {
    const req = authRequest('/api/budgets', {
      method: 'POST',
      body: { month: 6, year: 2024, amount: -100 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('amount must be a non-negative number');
  });

  it('allows zero amount budget', async () => {
    const req = authRequest('/api/budgets', {
      method: 'POST',
      body: { month: 6, year: 2024, amount: 0 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.budget.amount).toBe(0);
  });

  it('requires authentication', async () => {
    const req = makeRequest('/api/budgets', {
      method: 'POST',
      body: { month: 6, year: 2024, amount: 5000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/settings', () => {
  it('returns alert_threshold_percent', async () => {
    const req = authRequest('/api/settings');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.alert_threshold_percent).toBe(20);
  });

  it('requires authentication', async () => {
    const req = makeRequest('/api/settings');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/settings', () => {
  it('updates alert_threshold_percent', async () => {
    const req = authRequest('/api/settings', {
      method: 'PUT',
      body: { alert_threshold_percent: 30 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.alert_threshold_percent).toBe(30);
  });

  it('allows setting threshold to 0', async () => {
    const req = authRequest('/api/settings', {
      method: 'PUT',
      body: { alert_threshold_percent: 0 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.alert_threshold_percent).toBe(0);
  });

  it('allows setting threshold to 100', async () => {
    const req = authRequest('/api/settings', {
      method: 'PUT',
      body: { alert_threshold_percent: 100 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.alert_threshold_percent).toBe(100);
  });

  it('returns 400 when alert_threshold_percent is missing', async () => {
    const req = authRequest('/api/settings', {
      method: 'PUT',
      body: {},
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('alert_threshold_percent is required');
  });

  it('returns 400 for negative threshold', async () => {
    const req = authRequest('/api/settings', {
      method: 'PUT',
      body: { alert_threshold_percent: -5 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('alert_threshold_percent must be a number between 0 and 100');
  });

  it('returns 400 for threshold over 100', async () => {
    const req = authRequest('/api/settings', {
      method: 'PUT',
      body: { alert_threshold_percent: 101 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('alert_threshold_percent must be a number between 0 and 100');
  });

  it('returns 400 for non-numeric threshold', async () => {
    const req = authRequest('/api/settings', {
      method: 'PUT',
      body: { alert_threshold_percent: 'high' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('alert_threshold_percent must be a number between 0 and 100');
  });

  it('requires authentication', async () => {
    const req = makeRequest('/api/settings', {
      method: 'PUT',
      body: { alert_threshold_percent: 30 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });
});
