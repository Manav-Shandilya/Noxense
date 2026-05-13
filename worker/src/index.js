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

async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createToken(env) {
  const payload = { exp: Date.now() + 7 * 24 * 60 * 60 * 1000 };
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
    if (!payloadB64 || !sigHex) return false;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp < Date.now()) return false;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.AUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payloadB64));
  } catch {
    return false;
  }
}

function getToken(request) {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /api/login — public route
      if (path === '/api/login' && request.method === 'POST') {
        const { pin } = await request.json();
        if (!pin) return json({ error: 'PIN is required' }, 400);
        const hashed = await hashPin(String(pin));
        if (hashed !== env.PIN_HASH) {
          return json({ error: 'Invalid PIN' }, 401);
        }
        const token = await createToken(env);
        return json({ token });
      }

      // All other routes require auth
      const token = getToken(request);
      if (!token || !(await verifyToken(token, env))) {
        return json({ error: 'Unauthorized' }, 401);
      }

      // --- Protected routes below ---

      // GET /api/categories — list all categories
      if (path === '/api/categories' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, name, icon, excluded_from_budget, created_at FROM categories ORDER BY id'
        ).all();
        return json(results);
      }

      // POST /api/categories — create a new category
      if (path === '/api/categories' && request.method === 'POST') {
        const { name, icon } = await request.json();
        if (!name || !name.trim()) {
          return json({ error: 'Category name is required' }, 400);
        }
        try {
          const result = await env.DB.prepare(
            'INSERT INTO categories (name, icon) VALUES (?, ?)'
          ).bind(name.trim(), icon || null).run();
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

      // PUT /api/categories/:id — update a category
      if (path.startsWith('/api/categories/') && request.method === 'PUT') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid category ID' }, 400);

        const existing = await env.DB.prepare(
          'SELECT id FROM categories WHERE id = ?'
        ).bind(id).first();
        if (!existing) return json({ error: 'Category not found' }, 404);

        const body = await request.json();
        const updates = [];
        const values = [];

        if (body.name !== undefined) {
          if (!body.name || !body.name.trim()) {
            return json({ error: 'Category name is required' }, 400);
          }
          updates.push('name = ?');
          values.push(body.name.trim());
        }
        if (body.icon !== undefined) {
          updates.push('icon = ?');
          values.push(body.icon || null);
        }
        if (body.excluded_from_budget !== undefined) {
          updates.push('excluded_from_budget = ?');
          values.push(body.excluded_from_budget ? 1 : 0);
        }

        if (updates.length === 0) {
          return json({ error: 'No fields to update' }, 400);
        }

        values.push(id);
        try {
          await env.DB.prepare(
            `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`
          ).bind(...values).run();
          const category = await env.DB.prepare(
            'SELECT id, name, icon, excluded_from_budget, created_at FROM categories WHERE id = ?'
          ).bind(id).first();
          return json(category);
        } catch (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return json({ error: 'Category name already exists' }, 400);
          }
          throw err;
        }
      }

      // DELETE /api/categories/:id — delete a category
      if (path.startsWith('/api/categories/') && request.method === 'DELETE') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid category ID' }, 400);

        const existing = await env.DB.prepare(
          'SELECT id FROM categories WHERE id = ?'
        ).bind(id).first();
        if (!existing) return json({ error: 'Category not found' }, 404);

        const { count } = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM transactions WHERE category_id = ?'
        ).bind(id).first();
        if (count > 0) {
          return json({ error: 'Cannot delete category with linked transactions' }, 409);
        }

        await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // GET /api/accounts — list accounts with computed current balance
      if (path === '/api/accounts' && request.method === 'GET') {
        const { results: accounts } = await env.DB.prepare(
          'SELECT id, name, initial_balance, created_at FROM accounts ORDER BY id'
        ).all();

        const accountsWithBalance = [];
        for (const account of accounts) {
          const income = await env.DB.prepare(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'income'"
          ).bind(account.id).first();
          const expenses = await env.DB.prepare(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'expense'"
          ).bind(account.id).first();
          accountsWithBalance.push({
            ...account,
            current_balance: account.initial_balance + income.total - expenses.total,
          });
        }
        return json(accountsWithBalance);
      }

      // POST /api/accounts — create a new account
      if (path === '/api/accounts' && request.method === 'POST') {
        const body = await request.json();
        const { name, initial_balance } = body;

        if (!name || !name.trim()) {
          return json({ error: 'Account name is required' }, 400);
        }

        const balance = typeof initial_balance === 'number' ? initial_balance : 0;

        const result = await env.DB.prepare(
          'INSERT INTO accounts (name, initial_balance) VALUES (?, ?)'
        ).bind(name.trim(), balance).run();

        const account = await env.DB.prepare(
          'SELECT id, name, initial_balance, created_at FROM accounts WHERE id = ?'
        ).bind(result.meta.last_row_id).first();

        return json({ ...account, current_balance: account.initial_balance }, 201);
      }

      // PUT /api/accounts/:id — update an account
      if (path.startsWith('/api/accounts/') && request.method === 'PUT') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid account ID' }, 400);

        const existing = await env.DB.prepare(
          'SELECT id FROM accounts WHERE id = ?'
        ).bind(id).first();
        if (!existing) return json({ error: 'Account not found' }, 404);

        const body = await request.json();
        const updates = [];
        const values = [];

        if (body.name !== undefined) {
          if (!body.name || !body.name.trim()) {
            return json({ error: 'Account name is required' }, 400);
          }
          updates.push('name = ?');
          values.push(body.name.trim());
        }
        if (body.initial_balance !== undefined) {
          if (typeof body.initial_balance !== 'number') {
            return json({ error: 'initial_balance must be a number' }, 400);
          }
          updates.push('initial_balance = ?');
          values.push(body.initial_balance);
        }

        if (updates.length === 0) {
          return json({ error: 'No fields to update' }, 400);
        }

        values.push(id);
        await env.DB.prepare(
          `UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run();

        const account = await env.DB.prepare(
          'SELECT id, name, initial_balance, created_at FROM accounts WHERE id = ?'
        ).bind(id).first();

        // Compute current balance
        const income = await env.DB.prepare(
          "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'income'"
        ).bind(id).first();
        const expenses = await env.DB.prepare(
          "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'expense'"
        ).bind(id).first();

        return json({
          ...account,
          current_balance: account.initial_balance + income.total - expenses.total,
        });
      }

      // DELETE /api/accounts/:id — delete an account
      if (path.startsWith('/api/accounts/') && request.method === 'DELETE') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid account ID' }, 400);

        const existing = await env.DB.prepare(
          'SELECT id FROM accounts WHERE id = ?'
        ).bind(id).first();
        if (!existing) return json({ error: 'Account not found' }, 404);

        const { count } = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM transactions WHERE account_id = ?'
        ).bind(id).first();
        if (count > 0) {
          return json({ error: 'Cannot delete account with linked transactions' }, 409);
        }

        await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // GET /api/transactions — list transactions filtered by month/year
      if (path === '/api/transactions' && request.method === 'GET') {
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');

        if (!month || !year) {
          return json({ error: 'month and year query params are required' }, 400);
        }

        const monthPadded = String(month).padStart(2, '0');
        const datePrefix = `${year}-${monthPadded}-%`;

        const { results } = await env.DB.prepare(
          `SELECT t.id, t.type, t.amount, t.category_id, c.name as categoryName,
                  t.account_id, a.name as accountName, t.date, t.note, t.created_at
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN accounts a ON t.account_id = a.id
           WHERE t.date LIKE ?
           ORDER BY t.date DESC, t.id DESC`
        ).bind(datePrefix).all();

        return json(results);
      }

      // POST /api/transactions — create a transaction
      if (path === '/api/transactions' && request.method === 'POST') {
        const body = await request.json();
        const { amount, type, category_id, account_id, date, note } = body;

        // Validate amount
        if (amount === undefined || amount === null) {
          return json({ error: 'amount is required' }, 400);
        }
        if (typeof amount !== 'number' || amount <= 0) {
          return json({ error: 'amount must be a positive number' }, 400);
        }

        // Validate type
        if (!type) {
          return json({ error: 'type is required' }, 400);
        }
        if (type !== 'income' && type !== 'expense') {
          return json({ error: "type must be 'income' or 'expense'" }, 400);
        }

        // Validate account_id
        if (!account_id && account_id !== 0) {
          return json({ error: 'account_id is required' }, 400);
        }
        const account = await env.DB.prepare(
          'SELECT id FROM accounts WHERE id = ?'
        ).bind(account_id).first();
        if (!account) {
          return json({ error: 'Account not found' }, 400);
        }

        // Validate category_id
        if (!category_id && category_id !== 0) {
          return json({ error: 'category_id is required' }, 400);
        }
        const category = await env.DB.prepare(
          'SELECT id FROM categories WHERE id = ?'
        ).bind(category_id).first();
        if (!category) {
          return json({ error: 'Category not found' }, 400);
        }

        // Validate date
        if (!date) {
          return json({ error: 'date is required' }, 400);
        }
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(date)) {
          return json({ error: 'date must be in YYYY-MM-DD format' }, 400);
        }

        const noteValue = note || '';

        const result = await env.DB.prepare(
          'INSERT INTO transactions (amount, type, category_id, account_id, date, note) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(amount, type, category_id, account_id, date, noteValue).run();

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

      // PUT /api/transactions/:id — update a transaction
      if (path.startsWith('/api/transactions/') && request.method === 'PUT') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid transaction ID' }, 400);

        const existing = await env.DB.prepare(
          'SELECT id FROM transactions WHERE id = ?'
        ).bind(id).first();
        if (!existing) return json({ error: 'Transaction not found' }, 404);

        const body = await request.json();
        const updates = [];
        const values = [];

        if (body.amount !== undefined) {
          if (typeof body.amount !== 'number' || body.amount <= 0) {
            return json({ error: 'amount must be a positive number' }, 400);
          }
          updates.push('amount = ?');
          values.push(body.amount);
        }

        if (body.type !== undefined) {
          if (body.type !== 'income' && body.type !== 'expense') {
            return json({ error: "type must be 'income' or 'expense'" }, 400);
          }
          updates.push('type = ?');
          values.push(body.type);
        }

        if (body.account_id !== undefined) {
          const account = await env.DB.prepare(
            'SELECT id FROM accounts WHERE id = ?'
          ).bind(body.account_id).first();
          if (!account) {
            return json({ error: 'Account not found' }, 400);
          }
          updates.push('account_id = ?');
          values.push(body.account_id);
        }

        if (body.category_id !== undefined) {
          const category = await env.DB.prepare(
            'SELECT id FROM categories WHERE id = ?'
          ).bind(body.category_id).first();
          if (!category) {
            return json({ error: 'Category not found' }, 400);
          }
          updates.push('category_id = ?');
          values.push(body.category_id);
        }

        if (body.date !== undefined) {
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(body.date)) {
            return json({ error: 'date must be in YYYY-MM-DD format' }, 400);
          }
          updates.push('date = ?');
          values.push(body.date);
        }

        if (body.note !== undefined) {
          updates.push('note = ?');
          values.push(body.note);
        }

        if (updates.length === 0) {
          return json({ error: 'No fields to update' }, 400);
        }

        values.push(id);
        await env.DB.prepare(
          `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run();

        const transaction = await env.DB.prepare(
          `SELECT t.id, t.type, t.amount, t.category_id, c.name as categoryName,
                  t.account_id, a.name as accountName, t.date, t.note, t.created_at
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN accounts a ON t.account_id = a.id
           WHERE t.id = ?`
        ).bind(id).first();

        return json(transaction);
      }

      // DELETE /api/transactions/:id — delete a transaction
      if (path.startsWith('/api/transactions/') && request.method === 'DELETE') {
        const id = parseInt(path.split('/')[3]);
        if (isNaN(id)) return json({ error: 'Invalid transaction ID' }, 400);

        const existing = await env.DB.prepare(
          'SELECT id FROM transactions WHERE id = ?'
        ).bind(id).first();
        if (!existing) return json({ error: 'Transaction not found' }, 404);

        await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // GET /api/budgets — get budget for month/year (with carry-forward)
      if (path === '/api/budgets' && request.method === 'GET') {
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');

        if (!month || !year) {
          return json({ error: 'month and year query params are required' }, 400);
        }

        const monthNum = parseInt(month);
        const yearNum = parseInt(year);

        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          return json({ error: 'month must be between 1 and 12' }, 400);
        }
        if (isNaN(yearNum)) {
          return json({ error: 'year must be a valid number' }, 400);
        }

        // Try to find budget for the exact month/year
        let budget = await env.DB.prepare(
          'SELECT id, month, year, amount, created_at FROM budgets WHERE month = ? AND year = ?'
        ).bind(monthNum, yearNum).first();

        // If no budget found, carry forward from most recent previous month
        if (!budget) {
          budget = await env.DB.prepare(
            `SELECT id, month, year, amount, created_at FROM budgets
             WHERE (year < ? OR (year = ? AND month < ?))
             ORDER BY year DESC, month DESC
             LIMIT 1`
          ).bind(yearNum, yearNum, monthNum).first();
        }

        if (!budget) {
          return json({ budget: null });
        }

        return json({ budget });
      }

      // POST /api/budgets — set/update budget for a specific month/year (upsert)
      if (path === '/api/budgets' && request.method === 'POST') {
        const body = await request.json();
        const { month, year, amount } = body;

        if (month === undefined || month === null) {
          return json({ error: 'month is required' }, 400);
        }
        if (year === undefined || year === null) {
          return json({ error: 'year is required' }, 400);
        }
        if (amount === undefined || amount === null) {
          return json({ error: 'amount is required' }, 400);
        }

        const monthNum = parseInt(month);
        const yearNum = parseInt(year);

        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          return json({ error: 'month must be between 1 and 12' }, 400);
        }
        if (isNaN(yearNum)) {
          return json({ error: 'year must be a valid number' }, 400);
        }
        if (typeof amount !== 'number' || amount < 0) {
          return json({ error: 'amount must be a non-negative number' }, 400);
        }

        await env.DB.prepare(
          'INSERT OR REPLACE INTO budgets (month, year, amount) VALUES (?, ?, ?)'
        ).bind(monthNum, yearNum, amount).run();

        const budget = await env.DB.prepare(
          'SELECT id, month, year, amount, created_at FROM budgets WHERE month = ? AND year = ?'
        ).bind(monthNum, yearNum).first();

        return json({ budget }, 201);
      }

      // GET /api/settings — get alert_threshold_percent
      if (path === '/api/settings' && request.method === 'GET') {
        const settings = await env.DB.prepare(
          'SELECT alert_threshold_percent FROM settings WHERE id = 1'
        ).first();

        if (!settings) {
          return json({ alert_threshold_percent: 20 });
        }

        return json({ alert_threshold_percent: settings.alert_threshold_percent });
      }

      // PUT /api/settings — update alert_threshold_percent
      if (path === '/api/settings' && request.method === 'PUT') {
        const body = await request.json();
        const { alert_threshold_percent } = body;

        if (alert_threshold_percent === undefined || alert_threshold_percent === null) {
          return json({ error: 'alert_threshold_percent is required' }, 400);
        }
        if (typeof alert_threshold_percent !== 'number' || alert_threshold_percent < 0 || alert_threshold_percent > 100) {
          return json({ error: 'alert_threshold_percent must be a number between 0 and 100' }, 400);
        }

        await env.DB.prepare(
          'INSERT OR REPLACE INTO settings (id, alert_threshold_percent) VALUES (1, ?)'
        ).bind(alert_threshold_percent).run();

        return json({ alert_threshold_percent });
      }

      // GET /api/dashboard — aggregated dashboard data for a month
      if (path === '/api/dashboard' && request.method === 'GET') {
        const month = url.searchParams.get('month');
        const year = url.searchParams.get('year');

        if (!month || !year) {
          return json({ error: 'month and year query params are required' }, 400);
        }

        const monthNum = parseInt(month);
        const yearNum = parseInt(year);

        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          return json({ error: 'month must be between 1 and 12' }, 400);
        }
        if (isNaN(yearNum)) {
          return json({ error: 'year must be a valid number' }, 400);
        }

        const monthPadded = String(monthNum).padStart(2, '0');
        const datePrefix = `${yearNum}-${monthPadded}-%`;

        // Total income for the month
        const incomeResult = await env.DB.prepare(
          "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'income' AND date LIKE ?"
        ).bind(datePrefix).first();
        const totalIncome = incomeResult.total;

        // Total expenses for the month
        const expenseResult = await env.DB.prepare(
          "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'expense' AND date LIKE ?"
        ).bind(datePrefix).first();
        const totalExpenses = expenseResult.total;

        // Budget amount (with carry-forward)
        let budgetRow = await env.DB.prepare(
          'SELECT amount FROM budgets WHERE month = ? AND year = ?'
        ).bind(monthNum, yearNum).first();

        if (!budgetRow) {
          budgetRow = await env.DB.prepare(
            `SELECT amount FROM budgets
             WHERE (year < ? OR (year = ? AND month < ?))
             ORDER BY year DESC, month DESC
             LIMIT 1`
          ).bind(yearNum, yearNum, monthNum).first();
        }

        const budgetAmount = budgetRow ? budgetRow.amount : 0;

        // Remaining budget = budgetAmount - SUM(expenses in non-excluded categories)
        const nonExcludedExpenses = await env.DB.prepare(
          `SELECT COALESCE(SUM(t.amount), 0) as total
           FROM transactions t
           JOIN categories c ON t.category_id = c.id
           WHERE t.type = 'expense' AND t.date LIKE ? AND c.excluded_from_budget = 0`
        ).bind(datePrefix).first();

        const remainingBudget = budgetAmount - nonExcludedExpenses.total;

        // Budget utilization percent
        const budgetUtilizationPercent = budgetAmount > 0
          ? ((budgetAmount - remainingBudget) / budgetAmount) * 100
          : 0;

        // Alert threshold
        const settingsRow = await env.DB.prepare(
          'SELECT alert_threshold_percent FROM settings WHERE id = 1'
        ).first();
        const alertThresholdPercent = settingsRow ? settingsRow.alert_threshold_percent : 20;

        // Flags
        const isOverBudget = remainingBudget <= 0;
        const isAboveThreshold = remainingBudget < budgetAmount * (alertThresholdPercent / 100);

        // Category breakdown (expense categories for this month)
        const { results: categoryBreakdown } = await env.DB.prepare(
          `SELECT t.category_id as categoryId, c.name, COALESCE(SUM(t.amount), 0) as total
           FROM transactions t
           JOIN categories c ON t.category_id = c.id
           WHERE t.type = 'expense' AND t.date LIKE ?
           GROUP BY t.category_id, c.name
           ORDER BY total DESC`
        ).bind(datePrefix).all();

        // Accounts with balances (all-time balance, not just this month)
        const { results: allAccounts } = await env.DB.prepare(
          'SELECT id, name, initial_balance FROM accounts ORDER BY id'
        ).all();

        const accounts = [];
        for (const acct of allAccounts) {
          const acctIncome = await env.DB.prepare(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'income'"
          ).bind(acct.id).first();
          const acctExpenses = await env.DB.prepare(
            "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND type = 'expense'"
          ).bind(acct.id).first();
          accounts.push({
            id: acct.id,
            name: acct.name,
            balance: acct.initial_balance + acctIncome.total - acctExpenses.total,
          });
        }

        const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

        return json({
          month: monthNum,
          year: yearNum,
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
        });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
