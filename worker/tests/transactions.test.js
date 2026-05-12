import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src/index.js';

const PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const AUTH_SECRET = 'test-secret-key-for-hmac';

// In-memory D1 mock for transactions
function createMockDB() {
  let categories = [
    { id: 1, name: 'Food', icon: null, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' },
    { id: 2, name: 'Transport', icon: null, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' },
  ];
  let accounts = [
    { id: 1, name: 'HDFC Savings', initial_balance: 10000, created_at: '2024-01-01 00:00:00' },
    { id: 2, name: 'ICICI Credit', initial_balance: 5000, created_at: '2024-01-01 00:00:00' },
  ];
  let transactions = [];
  let nextTransactionId = 1;

  return {
    prepare(sql) {
      return {
        bind(...params) {
          this._params = params;
          return this;
        },
        async all() {
          if (sql.includes('FROM transactions t')) {
            // GET /api/transactions with JOIN
            const datePrefix = this._params[0];
            const pattern = datePrefix.replace('%', '');
            const filtered = transactions.filter(t => t.date.startsWith(pattern));
            const results = filtered.map(t => {
              const cat = categories.find(c => c.id === t.category_id);
              const acc = accounts.find(a => a.id === t.account_id);
              return {
                id: t.id,
                type: t.type,
                amount: t.amount,
                category_id: t.category_id,
                categoryName: cat ? cat.name : null,
                account_id: t.account_id,
                accountName: acc ? acc.name : null,
                date: t.date,
                note: t.note,
                created_at: t.created_at,
              };
            });
            return { results };
          }
          if (sql.includes('FROM accounts')) {
            return { results: [...accounts] };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM transactions t') && sql.includes('WHERE t.id')) {
            const id = this._params[0];
            const t = transactions.find(tr => tr.id === id);
            if (!t) return null;
            const cat = categories.find(c => c.id === t.category_id);
            const acc = accounts.find(a => a.id === t.account_id);
            return {
              id: t.id,
              type: t.type,
              amount: t.amount,
              category_id: t.category_id,
              categoryName: cat ? cat.name : null,
              account_id: t.account_id,
              accountName: acc ? acc.name : null,
              date: t.date,
              note: t.note,
              created_at: t.created_at,
            };
          }
          if (sql.includes('SELECT id FROM transactions WHERE id')) {
            const id = this._params[0];
            return transactions.find(t => t.id === id) || null;
          }
          if (sql.includes('SELECT id FROM accounts WHERE id')) {
            const id = this._params[0];
            return accounts.find(a => a.id === id) || null;
          }
          if (sql.includes('SELECT id FROM categories WHERE id')) {
            const id = this._params[0];
            return categories.find(c => c.id === id) || null;
          }
          if (sql.includes('COUNT') && sql.includes('FROM transactions WHERE account_id')) {
            const accountId = this._params[0];
            const count = transactions.filter(t => t.account_id === accountId).length;
            return { count };
          }
          if (sql.includes('COUNT') && sql.includes('FROM transactions WHERE category_id')) {
            const categoryId = this._params[0];
            const count = transactions.filter(t => t.category_id === categoryId).length;
            return { count };
          }
          if (sql.includes('SUM(amount)') && sql.includes("type = 'income'")) {
            const accountId = this._params[0];
            const total = transactions
              .filter(t => t.account_id === accountId && t.type === 'income')
              .reduce((sum, t) => sum + t.amount, 0);
            return { total };
          }
          if (sql.includes('SUM(amount)') && sql.includes("type = 'expense'")) {
            const accountId = this._params[0];
            const total = transactions
              .filter(t => t.account_id === accountId && t.type === 'expense')
              .reduce((sum, t) => sum + t.amount, 0);
            return { total };
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO transactions')) {
            const [amount, type, category_id, account_id, date, note] = this._params;
            const id = nextTransactionId++;
            const newTransaction = {
              id, amount, type, category_id, account_id, date,
              note: note || '', created_at: '2024-01-01 00:00:00',
            };
            transactions.push(newTransaction);
            return { meta: { last_row_id: id } };
          }
          if (sql.includes('UPDATE transactions SET')) {
            const id = this._params[this._params.length - 1];
            const t = transactions.find(tr => tr.id === id);
            if (!t) return {};
            const setClauses = sql.match(/SET (.+) WHERE/)[1].split(', ');
            let paramIdx = 0;
            for (const clause of setClauses) {
              const field = clause.split(' = ')[0].trim();
              t[field] = this._params[paramIdx++];
            }
            return {};
          }
          if (sql.includes('DELETE FROM transactions')) {
            const id = this._params[0];
            transactions = transactions.filter(t => t.id !== id);
            return {};
          }
          return {};
        },
      };
    },
    // Test helpers
    _addTransaction(t) {
      const id = nextTransactionId++;
      const transaction = { id, note: '', created_at: '2024-01-01 00:00:00', ...t };
      transactions.push(transaction);
      return transaction;
    },
    _getTransactions() { return transactions; },
    _reset() {
      categories = [
        { id: 1, name: 'Food', icon: null, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' },
        { id: 2, name: 'Transport', icon: null, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' },
      ];
      accounts = [
        { id: 1, name: 'HDFC Savings', initial_balance: 10000, created_at: '2024-01-01 00:00:00' },
        { id: 2, name: 'ICICI Credit', initial_balance: 5000, created_at: '2024-01-01 00:00:00' },
      ];
      transactions = [];
      nextTransactionId = 1;
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

describe('GET /api/transactions', () => {
  it('returns transactions filtered by month and year', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });
    mockDB._addTransaction({ amount: 200, type: 'income', category_id: 2, account_id: 1, date: '2024-03-20' });
    mockDB._addTransaction({ amount: 50, type: 'expense', category_id: 1, account_id: 1, date: '2024-04-01' });

    const req = authRequest('/api/transactions?month=3&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data).toHaveLength(2);
    expect(data[0].amount).toBe(100);
    expect(data[1].amount).toBe(200);
  });

  it('includes category and account names in response', async () => {
    mockDB._addTransaction({ amount: 500, type: 'expense', category_id: 1, account_id: 1, date: '2024-06-10' });

    const req = authRequest('/api/transactions?month=6&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data[0].categoryName).toBe('Food');
    expect(data[0].accountName).toBe('HDFC Savings');
  });

  it('returns 400 when month is missing', async () => {
    const req = authRequest('/api/transactions?year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month and year query params are required');
  });

  it('returns 400 when year is missing', async () => {
    const req = authRequest('/api/transactions?month=3');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('month and year query params are required');
  });

  it('returns empty array when no transactions match', async () => {
    const req = authRequest('/api/transactions?month=12&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data).toHaveLength(0);
  });

  it('pads single-digit months correctly', async () => {
    mockDB._addTransaction({ amount: 75, type: 'expense', category_id: 1, account_id: 1, date: '2024-01-05' });

    const req = authRequest('/api/transactions?month=1&year=2024');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data).toHaveLength(1);
    expect(data[0].amount).toBe(75);
  });

  it('requires authentication', async () => {
    const req = makeRequest('/api/transactions?month=3&year=2024');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/transactions', () => {
  it('creates a valid transaction', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 150, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15', note: 'Lunch' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.amount).toBe(150);
    expect(data.type).toBe('expense');
    expect(data.category_id).toBe(1);
    expect(data.account_id).toBe(1);
    expect(data.date).toBe('2024-03-15');
    expect(data.note).toBe('Lunch');
    expect(data.categoryName).toBe('Food');
    expect(data.accountName).toBe('HDFC Savings');
    expect(data.id).toBeDefined();
  });

  it('defaults note to empty string when not provided', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, type: 'income', category_id: 1, account_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.note).toBe('');
  });

  it('returns 400 when amount is missing', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('amount is required');
  });

  it('returns 400 when amount is not a positive number', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: -10, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('amount must be a positive number');
  });

  it('returns 400 when amount is zero', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 0, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('amount must be a positive number');
  });

  it('returns 400 when type is missing', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, category_id: 1, account_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('type is required');
  });

  it('returns 400 when type is invalid', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, type: 'transfer', category_id: 1, account_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe("type must be 'income' or 'expense'");
  });

  it('returns 400 when account_id is missing', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, type: 'expense', category_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('account_id is required');
  });

  it('returns 400 when account_id references non-existent account', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, type: 'expense', category_id: 1, account_id: 999, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Account not found');
  });

  it('returns 400 when category_id is missing', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, type: 'expense', account_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('category_id is required');
  });

  it('returns 400 when category_id references non-existent category', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, type: 'expense', category_id: 999, account_id: 1, date: '2024-03-15' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Category not found');
  });

  it('returns 400 when date is missing', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, type: 'expense', category_id: 1, account_id: 1 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('date is required');
  });

  it('returns 400 when date format is invalid', async () => {
    const req = authRequest('/api/transactions', {
      method: 'POST',
      body: { amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '15-03-2024' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('date must be in YYYY-MM-DD format');
  });
});

describe('PUT /api/transactions/:id', () => {
  it('updates transaction amount', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { amount: 200 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.amount).toBe(200);
  });

  it('updates transaction type', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { type: 'income' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.type).toBe('income');
  });

  it('updates transaction category', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { category_id: 2 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.category_id).toBe(2);
    expect(data.categoryName).toBe('Transport');
  });

  it('updates transaction account', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { account_id: 2 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.account_id).toBe(2);
    expect(data.accountName).toBe('ICICI Credit');
  });

  it('updates transaction date', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { date: '2024-04-01' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.date).toBe('2024-04-01');
  });

  it('updates transaction note', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { note: 'Updated note' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.note).toBe('Updated note');
  });

  it('returns 404 for non-existent transaction', async () => {
    const req = authRequest('/api/transactions/999', {
      method: 'PUT',
      body: { amount: 200 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
    const data = await getJson(res);
    expect(data.error).toBe('Transaction not found');
  });

  it('returns 400 for invalid ID', async () => {
    const req = authRequest('/api/transactions/abc', {
      method: 'PUT',
      body: { amount: 200 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Invalid transaction ID');
  });

  it('returns 400 when no fields provided', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: {},
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('No fields to update');
  });

  it('returns 400 for invalid amount on update', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { amount: -5 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('amount must be a positive number');
  });

  it('returns 400 for invalid type on update', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { type: 'transfer' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe("type must be 'income' or 'expense'");
  });

  it('returns 400 for non-existent account_id on update', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { account_id: 999 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Account not found');
  });

  it('returns 400 for non-existent category_id on update', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { category_id: 999 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Category not found');
  });

  it('returns 400 for invalid date format on update', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', {
      method: 'PUT',
      body: { date: '15/03/2024' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('date must be in YYYY-MM-DD format');
  });
});

describe('DELETE /api/transactions/:id', () => {
  it('deletes an existing transaction', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });

    const req = authRequest('/api/transactions/1', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(204);
  });

  it('returns 404 for non-existent transaction', async () => {
    const req = authRequest('/api/transactions/999', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
    const data = await getJson(res);
    expect(data.error).toBe('Transaction not found');
  });

  it('returns 400 for invalid ID', async () => {
    const req = authRequest('/api/transactions/abc', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Invalid transaction ID');
  });

  it('transaction is removed from list after deletion', async () => {
    mockDB._addTransaction({ amount: 100, type: 'expense', category_id: 1, account_id: 1, date: '2024-03-15' });
    mockDB._addTransaction({ amount: 200, type: 'income', category_id: 2, account_id: 1, date: '2024-03-20' });

    // Delete first transaction
    const delReq = authRequest('/api/transactions/1', { method: 'DELETE' });
    const delRes = await worker.fetch(delReq, env);
    expect(delRes.status).toBe(204);

    // Verify it's gone from the list
    const listReq = authRequest('/api/transactions?month=3&year=2024');
    const listRes = await worker.fetch(listReq, env);
    const data = await getJson(listRes);
    expect(data).toHaveLength(1);
    expect(data[0].amount).toBe(200);
  });

  it('requires authentication', async () => {
    const req = makeRequest('/api/transactions/1', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });
});
