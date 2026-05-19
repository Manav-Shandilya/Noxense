const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createToken(userId, env) {
  const payload = { sub: userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  const payloadB64 = btoa(JSON.stringify(payload));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return payloadB64 + '.' + sigHex;
}

async function verifyToken(token, env) {
  try {
    const [payloadB64, sigHex] = token.split('.');
    if (!payloadB64 || !sigHex) return null;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp < Date.now()) return null;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.AUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payloadB64));
    return valid ? payload.sub : null;
  } catch {
    return null;
  }
}

function getToken(request) {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function seedDefaultCategories(db, userId) {
  const defaults = ['Food', 'Transport', 'Housing', 'Utilities', 'Entertainment', 'Health', 'Shopping', 'Investments', 'Salary', 'Other'];
  for (const name of defaults) {
    await db.prepare('INSERT OR IGNORE INTO categories (user_id, name) VALUES (?, ?)').bind(userId, name).run();
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /api/register — create a new user
      if (path === '/api/register' && request.method === 'POST') {
        const { email, password } = await request.json();
        if (!email || !email.trim()) return json({ error: 'Email is required' }, 400);
        if (!password || password.length < 4) return json({ error: 'Password must be at least 4 characters' }, 400);

        const passwordHash = await hashPassword(password);
        try {
          const result = await env.DB.prepare(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)'
          ).bind(email.trim().toLowerCase(), passwordHash).run();

          const userId = result.meta.last_row_id;

          // Seed default categories and settings for new user
          await seedDefaultCategories(env.DB, userId);
          await env.DB.prepare('INSERT INTO settings (user_id, alert_threshold_percent) VALUES (?, 20)').bind(userId).run();

          const token = await createToken(userId, env);
          return json({ token, userId }, 201);
        } catch (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return json({ error: 'Email already registered' }, 409);
          }
          throw err;
        }
      }

      // POST /api/login — authenticate with email + password
      if (path === '/api/login' && request.method === 'POST') {
        const body = await request.json();

        // Support both email/password login and PIN login
        if (body.email && body.password) {
          const { email, password } = body;
          const user = await env.DB.prepare(
            'SELECT id, password_hash FROM users WHERE email = ?'
          ).bind(email.trim().toLowerCase()).first();

          if (!user) return json({ error: 'Invalid credentials' }, 401);

          const passwordHash = await hashPassword(password);
          if (passwordHash !== user.password_hash) {
            return json({ error: 'Invalid credentials' }, 401);
          }

          const token = await createToken(user.id, env);
          return json({ token, userId: user.id });
        }

        // PIN-based login (for returning users with a token)
        if (body.pin && body.userId) {
          const { pin, userId } = body;
          const settings = await env.DB.prepare(
            'SELECT pin_hash FROM settings WHERE user_id = ?'
          ).bind(userId).first();

          if (!settings || !settings.pin_hash) {
            return json({ error: 'PIN not set' }, 400);
          }

          const pinHash = await hashPassword(String(pin));
          if (pinHash !== settings.pin_hash) {
            return json({ error: 'Invalid PIN' }, 401);
          }

          const token = await createToken(userId, env);
          return json({ token, userId });
        }

        return json({ error: 'Email/password or PIN/userId required' }, 400);
      }

      // POST /api/pin — set or update PIN for a user
      if (path === '/api/pin' && request.method === 'POST') {
        const token = getToken(request);
        const userId = token ? await verifyToken(token, env) : null;
        if (!userId) return json({ error: 'Unauthorized' }, 401);

        const { pin } = await request.json();
        if (!pin || String(pin).length < 4 || String(pin).length > 6) {
          return json({ error: 'PIN must be 4-6 digits' }, 400);
        }

        const pinHash = await hashPassword(String(pin));
        await env.DB.prepare(
          'UPDATE settings SET pin_hash = ? WHERE user_id = ?'
        ).bind(pinHash, userId).run();

        return json({ success: true });
      }

      // All other routes require auth
      const token = getToken(request);
      const userId = token ? await verifyToken(token, env) : null;
      if (!userId) {
        return json({ error: 'Unauthorized' }, 401);
      }

      // --- Protected routes below (all scoped to userId) ---

      // GET /api/categories
      if (path === '/api/categories' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, name, icon, excluded_from_budget, created_at FROM categories WHERE user_id = ? ORDER BY id'
        ).bind(userId).all();
        return json(results);
      }

      // POST /api/categories
      if (path === '/api/categories' && request.method === 'POST') {
        const { name, icon } = await request.json();
        if (!name || !name.trim()) return json({ error: 'Category name is required' }, 400);
        try {
          const result = await env.DB.prepare(
            'INSERT INTO categories (user_id, name, icon) VALUES (?, ?, ?)'
          ).bind(userId, name.trim(), icon || null).run();
          const category = await env.DB.prepare(
            'SELECT id, name, icon, excluded_from_budget, created_at FROM categories WHERE id = ?'
          ).bind(result.meta.last_row_id).first();
          return json(category, 201);
        } catch (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return json({ error: 'Category name already exists' }, 400);
          }
          throw err;
        }
      }

      // PUT /api/categories/:id
      if (path.startsWith('/api/categories/') && request.method === 'PUT') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid category ID' }, 400);

        const existing = await env.DB.prepare(
          'SELECT id FROM categories WHERE id = ? AND user_id = ?'
        ).bind(id, userId).first();
        if (!existing) return json({ error: 'Category not found' }, 404);

        const body = await request.json();
        const updates = [];
        const values = [];

        if (body.name !== undefined) {
          if (!body.name || !body.name.trim()) return json({ error: 'Category name is required' }, 400);
          updates.push('name = ?');
          values.push(body.name.trim());
        }
        if (body.icon !== undefined) { updates.push('icon = ?'); values.push(body.icon || null); }
        if (body.excluded_from_budget !== undefined) { updates.push('excluded_from_budget = ?'); values.push(body.excluded_from_budget ? 1 : 0); }

        if (updates.length === 0) return json({ error: 'No fields to update' }, 400);

        values.push(id);
        values.push(userId);
        try {
          await env.DB.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values).run();
          const category = await env.DB.prepare('SELECT id, name, icon, excluded_from_budget, created_at FROM categories WHERE id = ?').bind(id).first();
          return json(category);
        } catch (err) {
          if (err.message.includes('UNIQUE constraint failed')) return json({ error: 'Category name already exists' }, 400);
          throw err;
        }
      }

      // DELETE /api/categories/:id
      if (path.startsWith('/api/categories/') && request.method === 'DELETE') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid category ID' }, 400);

        const existing = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(id, userId).first();
        if (!existing) return json({ error: 'Category not found' }, 404);

        const { count } = await env.DB.prepare('SELECT COUNT(*) as count FROM transactions WHERE category_id = ? AND user_id = ?').bind(id, userId).first();
        if (count > 0) return json({ error: 'Cannot delete category with linked transactions' }, 409);

        await env.DB.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, userId).run();
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // GET /api/accounts
      if (path === '/api/accounts' && request.method === 'GET') {
        const { results: accounts } = await env.DB.prepare(
          'SELECT id, name, initial_balance, created_at FROM accounts WHERE user_id = ? ORDER BY id'
        ).bind(userId).all();

        const accountsWithBalance = [];
        for (const account of accounts) {
          const income = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND user_id = ? AND type = 'income'").bind(account.id, userId).first();
          const expenses = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND user_id = ? AND type = 'expense'").bind(account.id, userId).first();
          accountsWithBalance.push({ ...account, current_balance: account.initial_balance + income.total - expenses.total });
        }
        return json(accountsWithBalance);
      }

      // POST /api/accounts
      if (path === '/api/accounts' && request.method === 'POST') {
        const { name, initial_balance } = await request.json();
        if (!name || !name.trim()) return json({ error: 'Account name is required' }, 400);
        const balance = typeof initial_balance === 'number' ? initial_balance : 0;
        const result = await env.DB.prepare('INSERT INTO accounts (user_id, name, initial_balance) VALUES (?, ?, ?)').bind(userId, name.trim(), balance).run();
        const account = await env.DB.prepare('SELECT id, name, initial_balance, created_at FROM accounts WHERE id = ?').bind(result.meta.last_row_id).first();
        return json({ ...account, current_balance: account.initial_balance }, 201);
      }

      // PUT /api/accounts/:id
      if (path.startsWith('/api/accounts/') && request.method === 'PUT') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid account ID' }, 400);
        const existing = await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(id, userId).first();
        if (!existing) return json({ error: 'Account not found' }, 404);

        const body = await request.json();
        const updates = [];
        const values = [];
        if (body.name !== undefined) { if (!body.name || !body.name.trim()) return json({ error: 'Account name is required' }, 400); updates.push('name = ?'); values.push(body.name.trim()); }
        if (body.initial_balance !== undefined) { if (typeof body.initial_balance !== 'number') return json({ error: 'initial_balance must be a number' }, 400); updates.push('initial_balance = ?'); values.push(body.initial_balance); }
        if (updates.length === 0) return json({ error: 'No fields to update' }, 400);

        values.push(id); values.push(userId);
        await env.DB.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values).run();
        const account = await env.DB.prepare('SELECT id, name, initial_balance, created_at FROM accounts WHERE id = ?').bind(id).first();
        const income = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND user_id = ? AND type = 'income'").bind(id, userId).first();
        const expenses = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND user_id = ? AND type = 'expense'").bind(id, userId).first();
        return json({ ...account, current_balance: account.initial_balance + income.total - expenses.total });
      }

      // DELETE /api/accounts/:id
      if (path.startsWith('/api/accounts/') && request.method === 'DELETE') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid account ID' }, 400);
        const existing = await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(id, userId).first();
        if (!existing) return json({ error: 'Account not found' }, 404);
        const { count } = await env.DB.prepare('SELECT COUNT(*) as count FROM transactions WHERE account_id = ? AND user_id = ?').bind(id, userId).first();
        if (count > 0) return json({ error: 'Cannot delete account with linked transactions' }, 409);
        await env.DB.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').bind(id, userId).run();
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // GET /api/transactions
      if (path === '/api/transactions' && request.method === 'GET') {
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');
        if (!month || !year) return json({ error: 'month and year query params are required' }, 400);
        const monthPadded = String(month).padStart(2, '0');
        const datePrefix = `${year}-${monthPadded}-%`;
        const { results } = await env.DB.prepare(
          `SELECT t.id, t.type, t.amount, t.category_id, c.name as categoryName,
                  t.account_id, a.name as accountName, t.date, t.note, t.created_at
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN accounts a ON t.account_id = a.id
           WHERE t.user_id = ? AND t.date LIKE ?
           ORDER BY t.date DESC, t.id DESC`
        ).bind(userId, datePrefix).all();
        return json(results);
      }

      // POST /api/transactions
      if (path === '/api/transactions' && request.method === 'POST') {
        const body = await request.json();
        const { amount, type, category_id, account_id, date, note } = body;
        if (amount === undefined || amount === null) return json({ error: 'amount is required' }, 400);
        if (typeof amount !== 'number' || amount <= 0) return json({ error: 'amount must be a positive number' }, 400);
        if (!type) return json({ error: 'type is required' }, 400);
        if (type !== 'income' && type !== 'expense') return json({ error: "type must be 'income' or 'expense'" }, 400);
        if (!account_id && account_id !== 0) return json({ error: 'account_id is required' }, 400);
        const account = await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(account_id, userId).first();
        if (!account) return json({ error: 'Account not found' }, 400);
        if (!category_id && category_id !== 0) return json({ error: 'category_id is required' }, 400);
        const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(category_id, userId).first();
        if (!category) return json({ error: 'Category not found' }, 400);
        if (!date) return json({ error: 'date is required' }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'date must be in YYYY-MM-DD format' }, 400);

        const result = await env.DB.prepare(
          'INSERT INTO transactions (user_id, amount, type, category_id, account_id, date, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(userId, amount, type, category_id, account_id, date, note || '').run();

        const transaction = await env.DB.prepare(
          `SELECT t.id, t.type, t.amount, t.category_id, c.name as categoryName,
                  t.account_id, a.name as accountName, t.date, t.note, t.created_at
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN accounts a ON t.account_id = a.id
           WHERE t.id = ?`
        ).bind(result.meta.last_row_id).first();
        return json(transaction, 201);
      }

      // PUT /api/transactions/:id
      if (path.startsWith('/api/transactions/') && request.method === 'PUT') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid transaction ID' }, 400);
        const existing = await env.DB.prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?').bind(id, userId).first();
        if (!existing) return json({ error: 'Transaction not found' }, 404);

        const body = await request.json();
        const updates = [];
        const values = [];
        if (body.amount !== undefined) { if (typeof body.amount !== 'number' || body.amount <= 0) return json({ error: 'amount must be a positive number' }, 400); updates.push('amount = ?'); values.push(body.amount); }
        if (body.type !== undefined) { if (body.type !== 'income' && body.type !== 'expense') return json({ error: "type must be 'income' or 'expense'" }, 400); updates.push('type = ?'); values.push(body.type); }
        if (body.account_id !== undefined) { const a = await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(body.account_id, userId).first(); if (!a) return json({ error: 'Account not found' }, 400); updates.push('account_id = ?'); values.push(body.account_id); }
        if (body.category_id !== undefined) { const c = await env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').bind(body.category_id, userId).first(); if (!c) return json({ error: 'Category not found' }, 400); updates.push('category_id = ?'); values.push(body.category_id); }
        if (body.date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return json({ error: 'date must be in YYYY-MM-DD format' }, 400); updates.push('date = ?'); values.push(body.date); }
        if (body.note !== undefined) { updates.push('note = ?'); values.push(body.note); }
        if (updates.length === 0) return json({ error: 'No fields to update' }, 400);

        values.push(id); values.push(userId);
        await env.DB.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values).run();
        const transaction = await env.DB.prepare(
          `SELECT t.id, t.type, t.amount, t.category_id, c.name as categoryName, t.account_id, a.name as accountName, t.date, t.note, t.created_at
           FROM transactions t LEFT JOIN categories c ON t.category_id = c.id LEFT JOIN accounts a ON t.account_id = a.id WHERE t.id = ?`
        ).bind(id).first();
        return json(transaction);
      }

      // DELETE /api/transactions/:id
      if (path.startsWith('/api/transactions/') && request.method === 'DELETE') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid transaction ID' }, 400);
        const existing = await env.DB.prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?').bind(id, userId).first();
        if (!existing) return json({ error: 'Transaction not found' }, 404);
        await env.DB.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(id, userId).run();
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // GET /api/budgets
      if (path === '/api/budgets' && request.method === 'GET') {
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');
        if (!month || !year) return json({ error: 'month and year query params are required' }, 400);
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) return json({ error: 'month must be between 1 and 12' }, 400);
        if (isNaN(yearNum)) return json({ error: 'year must be a valid number' }, 400);

        let budget = await env.DB.prepare('SELECT id, month, year, amount, created_at FROM budgets WHERE user_id = ? AND month = ? AND year = ?').bind(userId, monthNum, yearNum).first();
        if (!budget) {
          budget = await env.DB.prepare('SELECT id, month, year, amount, created_at FROM budgets WHERE user_id = ? AND (year < ? OR (year = ? AND month < ?)) ORDER BY year DESC, month DESC LIMIT 1').bind(userId, yearNum, yearNum, monthNum).first();
        }
        return json({ budget: budget || null });
      }

      // POST /api/budgets
      if (path === '/api/budgets' && request.method === 'POST') {
        const { month, year, amount } = await request.json();
        if (month === undefined) return json({ error: 'month is required' }, 400);
        if (year === undefined) return json({ error: 'year is required' }, 400);
        if (amount === undefined) return json({ error: 'amount is required' }, 400);
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) return json({ error: 'month must be between 1 and 12' }, 400);
        if (isNaN(yearNum)) return json({ error: 'year must be a valid number' }, 400);
        if (typeof amount !== 'number' || amount < 0) return json({ error: 'amount must be a non-negative number' }, 400);

        await env.DB.prepare('INSERT OR REPLACE INTO budgets (user_id, month, year, amount) VALUES (?, ?, ?, ?)').bind(userId, monthNum, yearNum, amount).run();
        const budget = await env.DB.prepare('SELECT id, month, year, amount, created_at FROM budgets WHERE user_id = ? AND month = ? AND year = ?').bind(userId, monthNum, yearNum).first();
        return json({ budget }, 201);
      }

      // GET /api/settings
      if (path === '/api/settings' && request.method === 'GET') {
        const settings = await env.DB.prepare('SELECT alert_threshold_percent, pin_hash FROM settings WHERE user_id = ?').bind(userId).first();
        if (!settings) return json({ alert_threshold_percent: 20, has_pin: false });
        return json({ alert_threshold_percent: settings.alert_threshold_percent, has_pin: !!settings.pin_hash });
      }

      // PUT /api/settings
      if (path === '/api/settings' && request.method === 'PUT') {
        const { alert_threshold_percent } = await request.json();
        if (alert_threshold_percent === undefined) return json({ error: 'alert_threshold_percent is required' }, 400);
        if (typeof alert_threshold_percent !== 'number' || alert_threshold_percent < 0 || alert_threshold_percent > 100) return json({ error: 'alert_threshold_percent must be between 0 and 100' }, 400);
        await env.DB.prepare('UPDATE settings SET alert_threshold_percent = ? WHERE user_id = ?').bind(alert_threshold_percent, userId).run();
        return json({ alert_threshold_percent });
      }

      // GET /api/dashboard
      if (path === '/api/dashboard' && request.method === 'GET') {
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');
        if (!month || !year) return json({ error: 'month and year query params are required' }, 400);
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) return json({ error: 'month must be between 1 and 12' }, 400);
        if (isNaN(yearNum)) return json({ error: 'year must be a valid number' }, 400);

        const monthPadded = String(monthNum).padStart(2, '0');
        const datePrefix = `${yearNum}-${monthPadded}-%`;

        const incomeResult = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'income' AND date LIKE ?").bind(userId, datePrefix).first();
        const totalIncome = incomeResult.total;

        const expenseResult = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'expense' AND date LIKE ?").bind(userId, datePrefix).first();
        const totalExpenses = expenseResult.total;

        let budgetRow = await env.DB.prepare('SELECT amount FROM budgets WHERE user_id = ? AND month = ? AND year = ?').bind(userId, monthNum, yearNum).first();
        if (!budgetRow) {
          budgetRow = await env.DB.prepare('SELECT amount FROM budgets WHERE user_id = ? AND (year < ? OR (year = ? AND month < ?)) ORDER BY year DESC, month DESC LIMIT 1').bind(userId, yearNum, yearNum, monthNum).first();
        }
        const budgetAmount = budgetRow ? budgetRow.amount : 0;

        const nonExcludedExpenses = await env.DB.prepare(
          `SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? AND t.type = 'expense' AND t.date LIKE ? AND c.excluded_from_budget = 0`
        ).bind(userId, datePrefix).first();
        const remainingBudget = budgetAmount - nonExcludedExpenses.total;
        const budgetUtilizationPercent = budgetAmount > 0 ? ((budgetAmount - remainingBudget) / budgetAmount) * 100 : 0;

        const settingsRow = await env.DB.prepare('SELECT alert_threshold_percent FROM settings WHERE user_id = ?').bind(userId).first();
        const alertThresholdPercent = settingsRow ? settingsRow.alert_threshold_percent : 20;
        const isOverBudget = remainingBudget <= 0;
        const isAboveThreshold = remainingBudget < budgetAmount * (alertThresholdPercent / 100);

        const { results: categoryBreakdown } = await env.DB.prepare(
          `SELECT t.category_id as categoryId, c.name, COALESCE(SUM(t.amount), 0) as total FROM transactions t JOIN categories c ON t.category_id = c.id WHERE t.user_id = ? AND t.type = 'expense' AND t.date LIKE ? GROUP BY t.category_id, c.name ORDER BY total DESC`
        ).bind(userId, datePrefix).all();

        const { results: allAccounts } = await env.DB.prepare('SELECT id, name, initial_balance FROM accounts WHERE user_id = ? ORDER BY id').bind(userId).all();
        const accounts = [];
        for (const acct of allAccounts) {
          const ai = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND user_id = ? AND type = 'income'").bind(acct.id, userId).first();
          const ae = await env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND user_id = ? AND type = 'expense'").bind(acct.id, userId).first();
          accounts.push({ id: acct.id, name: acct.name, balance: acct.initial_balance + ai.total - ae.total });
        }
        const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

        return json({ month: monthNum, year: yearNum, totalIncome, totalExpenses, budgetAmount, remainingBudget, budgetUtilizationPercent, alertThresholdPercent, isOverBudget, isAboveThreshold, categoryBreakdown, accounts, totalBalance });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
