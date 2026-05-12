import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import worker from '../src/index.js';

const PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const AUTH_SECRET = 'test-secret-key-for-hmac';

// In-memory D1 mock
function createMockDB() {
  let categories = [
    { id: 1, name: 'Food', icon: null, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' },
    { id: 2, name: 'Transport', icon: null, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' },
  ];
  let transactions = [];
  let nextId = 3;

  return {
    prepare(sql) {
      return {
        bind(...params) {
          this._params = params;
          return this;
        },
        async all() {
          if (sql.includes('SELECT') && sql.includes('FROM categories')) {
            return { results: [...categories] };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes('SELECT') && sql.includes('FROM categories WHERE id')) {
            const id = this._params[0];
            return categories.find(c => c.id === id) || null;
          }
          if (sql.includes('COUNT') && sql.includes('FROM transactions')) {
            const categoryId = this._params[0];
            const count = transactions.filter(t => t.category_id === categoryId).length;
            return { count };
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO categories')) {
            const name = this._params[0];
            const icon = this._params[1];
            // Check unique constraint
            if (categories.some(c => c.name === name)) {
              throw new Error('UNIQUE constraint failed: categories.name');
            }
            const id = nextId++;
            const newCat = { id, name, icon, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' };
            categories.push(newCat);
            return { meta: { last_row_id: id } };
          }
          if (sql.includes('UPDATE categories SET')) {
            const id = this._params[this._params.length - 1];
            const cat = categories.find(c => c.id === id);
            if (!cat) return {};
            // Parse updates from params based on SQL
            const setClauses = sql.match(/SET (.+) WHERE/)[1].split(', ');
            let paramIdx = 0;
            for (const clause of setClauses) {
              const field = clause.split(' = ')[0].trim();
              const value = this._params[paramIdx++];
              // Check unique constraint for name
              if (field === 'name' && categories.some(c => c.name === value && c.id !== id)) {
                throw new Error('UNIQUE constraint failed: categories.name');
              }
              cat[field] = value;
            }
            return {};
          }
          if (sql.includes('DELETE FROM categories')) {
            const id = this._params[0];
            categories = categories.filter(c => c.id !== id);
            return {};
          }
          return {};
        },
      };
    },
    // Test helpers
    _addTransaction(t) { transactions.push(t); },
    _getCategories() { return categories; },
    _reset() {
      categories = [
        { id: 1, name: 'Food', icon: null, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' },
        { id: 2, name: 'Transport', icon: null, excluded_from_budget: 0, created_at: '2024-01-01 00:00:00' },
      ];
      transactions = [];
      nextId = 3;
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

describe('GET /api/categories', () => {
  it('returns all categories', async () => {
    const req = authRequest('/api/categories');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('Food');
    expect(data[1].name).toBe('Transport');
  });

  it('includes exclusion status in response', async () => {
    const req = authRequest('/api/categories');
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    expect(data[0]).toHaveProperty('excluded_from_budget');
    expect(data[0].excluded_from_budget).toBe(0);
  });
});

describe('POST /api/categories', () => {
  it('creates a new category with name', async () => {
    const req = authRequest('/api/categories', {
      method: 'POST',
      body: { name: 'Health' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.name).toBe('Health');
    expect(data.id).toBeDefined();
  });

  it('creates a category with name and icon', async () => {
    const req = authRequest('/api/categories', {
      method: 'POST',
      body: { name: 'Shopping', icon: '🛒' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(201);
    const data = await getJson(res);
    expect(data.name).toBe('Shopping');
    expect(data.icon).toBe('🛒');
  });

  it('returns 400 when name is missing', async () => {
    const req = authRequest('/api/categories', {
      method: 'POST',
      body: {},
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Category name is required');
  });

  it('returns 400 when name is empty string', async () => {
    const req = authRequest('/api/categories', {
      method: 'POST',
      body: { name: '   ' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Category name is required');
  });

  it('returns 400 for duplicate category name', async () => {
    const req = authRequest('/api/categories', {
      method: 'POST',
      body: { name: 'Food' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Category name already exists');
  });
});

describe('PUT /api/categories/:id', () => {
  it('updates category name', async () => {
    const req = authRequest('/api/categories/1', {
      method: 'PUT',
      body: { name: 'Groceries' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.name).toBe('Groceries');
  });

  it('updates category icon', async () => {
    const req = authRequest('/api/categories/1', {
      method: 'PUT',
      body: { icon: '🍕' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.icon).toBe('🍕');
  });

  it('updates excluded_from_budget flag', async () => {
    const req = authRequest('/api/categories/1', {
      method: 'PUT',
      body: { excluded_from_budget: true },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.excluded_from_budget).toBe(1);
  });

  it('returns 404 for non-existent category', async () => {
    const req = authRequest('/api/categories/999', {
      method: 'PUT',
      body: { name: 'Nope' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it('returns 400 when no fields provided', async () => {
    const req = authRequest('/api/categories/1', {
      method: 'PUT',
      body: {},
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('No fields to update');
  });

  it('returns 400 for invalid ID', async () => {
    const req = authRequest('/api/categories/abc', {
      method: 'PUT',
      body: { name: 'Test' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Invalid category ID');
  });

  it('returns 400 for duplicate name on update', async () => {
    const req = authRequest('/api/categories/1', {
      method: 'PUT',
      body: { name: 'Transport' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('Category name already exists');
  });
});

describe('DELETE /api/categories/:id', () => {
  it('deletes a category with no linked transactions', async () => {
    const req = authRequest('/api/categories/1', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(204);
  });

  it('returns 409 when category has linked transactions', async () => {
    mockDB._addTransaction({ id: 1, category_id: 1, account_id: 1, amount: 50, type: 'expense' });
    const req = authRequest('/api/categories/1', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(409);
    const data = await getJson(res);
    expect(data.error).toBe('Cannot delete category with linked transactions');
  });

  it('returns 404 for non-existent category', async () => {
    const req = authRequest('/api/categories/999', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid ID', async () => {
    const req = authRequest('/api/categories/abc', { method: 'DELETE' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });
});
