import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src/index.js';

const PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const AUTH_SECRET = 'test-secret-key-for-hmac';

// In-memory D1 mock for accounts
function createMockDB() {
  let accounts = [
    { id: 1, name: 'HDFC Savings', initial_balance: 10000, created_at: '2024-01-01 00:00:00' },
    { id: 2, name: 'ICICI Credit', initial_balance: 5000, created_at: '2024-01-01 00:00:00' },
  ];
  let transactions = [];
  let nextAccountId = 3;

  return {
    prepare(sql) {
      return {
        bind(...params) {
          this._params = params;
          return this;
        },
        async all() {
          if (sql.includes('SELECT') && sql.includes('FROM accounts')) {
            return { results: [...accounts] };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes('SELECT') && sql.includes('FROM accounts WHERE id')) {
            const id = this._params[0];
            return accounts.find(a => a.id === id) || null;
          }
          if (sql.includes('COUNT') && sql.includes('FROM transactions WHERE account_id')) {
            const accountId = this._params[0];
            const count = transactions.filter(t => t.account_id === accountId).length;
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
          if (sql.includes('INSERT INTO accounts')) {
            const name = this._params[0];
            const initial_balance = this._params[1];
            const id = nextAccountId++;
            const newAccount = { id, name, initial_balance, created_at: '2024-01-01 00:00:00' };
            accounts.push(newAccount);
            return { meta: { last_row_id: id } };
          }
          if (sql.includes('UPDATE accounts SET')) {
            const id = this._params[this._params.length - 1];
            const account = accounts.find(a => a.id === id);
            if (!account) return {};
            const setClauses = sql.match(/SET (.+) WHERE/)[1].split(', ');
            let paramIdx = 0;
            for (const clause of setClauses) {
              const field = clause.split(' = ')[0].trim();
              const value = this._params[paramIdx++];
              account[field] = value;
            }
            return {};
          }
          if (sql.includes('DELETE FROM accounts')) {
            const id = this._params[0];
            accounts = accounts.filter(a => a.id !== id);
            return {};
          }
          return {};
        },
      };
    },
    // Test helpers
    _addTransaction(t) { transactions.push(t); },
    _getAccounts() { return accounts; },
    _getTransactions() { return transactions; },
    _reset() {
      accounts = [
        { id: 1, name: 'HDFC Savings', initial_balance: 10000, created_at: '2024-01-01 00:00:00' },
        { id: 2, name: 'ICICI Credit', initial_balance: 5000, created_at: '2024-01-01 00:00:00' },
      ];
      transactions = [];
      nextAccountId = 3;
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

describe('GET /api/accounts', () => {
  it('returns all accounts with computed current balance', async () => {
    const req = authRequest('/api/accounts');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('HDFC Savings');
    expect(data[0].current_balance).toBe(10000);
    expect(data[1].name).toBe('ICICI Credit');
    expect(data[1].current_balance).toBe(5000);
  });

  it('computes balance with income transactions', async () => {
    mockDB._addTransaction({ id: 1, account_id: 1, type: 'income', amount: 2000, category_id: 1 });
    const req = authRequest('/api/accounts');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data[0].current_balance).toBe(12000); // 10000 + 2000
  });

  it('computes balance with expense transactions', async () => {
    mockDB._addTransaction({ id: 1, account_id: 1, type: 'expense', amount: 3000, category_id: 1 });
    const req = authRequest('/api/accounts');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data[0].current_balance).toBe(7000); // 10000 - 3000
  });

  it('computes balance with mixed transactions', async () => {
    mockDB._addTransaction({ id: 1, account_id: 1, type: 'income', amount: 5000, category_id: 1 });
    mockDB._addTransaction({ id: 2, account_id: 1, type: 'expense', amount: 2000, category_id: 1 });
    mockDB._addTransaction({ id: 3, account_id: 1, type: 'expense', amount: 1000, category_id: 1 });
    const req = authRequest('/api/accounts');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data[0].current_balance).toBe(12000); // 10000 + 5000 - 2000 - 1000
  });

  it('only counts transactions for the specific account', async () => {
    mockDB._addTransaction({ id: 1, account_id: 1, type: 'income', amount: 1000, category_id: 1 });
    mockDB._addTransaction({ id: 2, account_id: 2, type: 'expense', amount: 500, category_id: 1 });
    const req = authRequest('/api/accounts');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data[0].current_balance).toBe(11000); // 10000 + 1000
    expect(data[1].current_balance).toBe(4500); // 5000 - 500
  });

  it('requires authentication', async () => {
    const req = makeRequest('/api/accounts');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/accounts', () => {
  it('creates an account with name and initial_balance', async () => {
    const req = authRequest('/api/accounts', {
      method: 'POST',
      body: { name: 'SBI Savings', initial_balance: 25000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.name).toBe('SBI Savings');
    expect(data.initial_balance).toBe(25000);
    expect(data.current_balance).toBe(25000);
    expect(data.id).toBeDefined();
  });

  it('defaults initial_balance to 0 when not provided', async () => {
    const req = authRequest('/api/accounts', {
      method: 'POST',
      body: { name: 'Cash' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.initial_balance).toBe(0);
    expect(data.current_balance).toBe(0);
  });

  it('returns 400 when name is missing', async () => {
    const req = authRequest('/api/accounts', {
      method: 'POST',
      body: {},
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Account name is required');
  });

  it('returns 400 when name is empty string', async () => {
    const req = authRequest('/api/accounts', {
      method: 'POST',
      body: { name: '   ' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Account name is required');
  });

  it('trims whitespace from name', async () => {
    const req = authRequest('/api/accounts', {
      method: 'POST',
      body: { name: '  My Account  ', initial_balance: 100 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.name).toBe('My Account');
  });
});

describe('PUT /api/accounts/:id', () => {
  it('updates account name', async () => {
    const req = authRequest('/api/accounts/1', {
      method: 'PUT',
      body: { name: 'HDFC Current' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.name).toBe('HDFC Current');
  });

  it('updates initial_balance', async () => {
    const req = authRequest('/api/accounts/1', {
      method: 'PUT',
      body: { initial_balance: 20000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.initial_balance).toBe(20000);
    expect(data.current_balance).toBe(20000);
  });

  it('updates both name and initial_balance', async () => {
    const req = authRequest('/api/accounts/1', {
      method: 'PUT',
      body: { name: 'New Name', initial_balance: 15000 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.name).toBe('New Name');
    expect(data.initial_balance).toBe(15000);
  });

  it('returns current_balance reflecting transactions after update', async () => {
    mockDB._addTransaction({ id: 1, account_id: 1, type: 'income', amount: 3000, category_id: 1 });
    const req = authRequest('/api/accounts/1', {
      method: 'PUT',
      body: { initial_balance: 20000 },
    });
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data.current_balance).toBe(23000); // 20000 + 3000
  });

  it('returns 404 for non-existent account', async () => {
    const req = authRequest('/api/accounts/999', {
      method: 'PUT',
      body: { name: 'Nope' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
    const data = await getJson(res);
    expect(data.error).toBe('Account not found');
  });

  it('returns 400 when no fields provided', async () => {
    const req = authRequest('/api/accounts/1', {
      method: 'PUT',
      body: {},
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('No fields to update');
  });

  it('returns 400 for invalid ID', async () => {
    const req = authRequest('/api/accounts/abc', {
      method: 'PUT',
      body: { name: 'Test' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Invalid account ID');
  });

  it('returns 400 when name is empty', async () => {
    const req = authRequest('/api/accounts/1', {
      method: 'PUT',
      body: { name: '' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Account name is required');
  });

  it('returns 400 when initial_balance is not a number', async () => {
    const req = authRequest('/api/accounts/1', {
      method: 'PUT',
      body: { initial_balance: 'abc' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('initial_balance must be a number');
  });
});

describe('DELETE /api/accounts/:id', () => {
  it('deletes an account with no linked transactions', async () => {
    const req = authRequest('/api/accounts/1', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(204);
  });

  it('returns 409 when account has linked transactions', async () => {
    mockDB._addTransaction({ id: 1, account_id: 1, type: 'expense', amount: 500, category_id: 1 });
    const req = authRequest('/api/accounts/1', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(409);
    const data = await getJson(res);
    expect(data.error).toBe('Cannot delete account with linked transactions');
  });

  it('returns 404 for non-existent account', async () => {
    const req = authRequest('/api/accounts/999', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
    const data = await getJson(res);
    expect(data.error).toBe('Account not found');
  });

  it('returns 400 for invalid ID', async () => {
    const req = authRequest('/api/accounts/abc', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Invalid account ID');
  });

  it('allows deleting account after all its transactions are removed', async () => {
    // Initially has no transactions, should succeed
    const req = authRequest('/api/accounts/2', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(204);
  });
});
