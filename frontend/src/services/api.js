import { enqueue, isOnline } from './offlineQueue';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return sessionStorage.getItem('token');
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function handle401(res) {
  if (res.status === 401) {
    sessionStorage.removeItem('token');
    window.location.reload();
    throw new Error('Session expired');
  }
}

/**
 * Perform a mutation (POST/PUT/DELETE). If offline, queue it.
 * Returns the response JSON or { queued: true } if offline.
 */
async function mutate(url, method, body) {
  if (!isOnline()) {
    await enqueue({ method, url, body });
    return { queued: true };
  }
  const headers = { 'Content-Type': 'application/json', ...authHeaders() };
  const opts = { method, headers };
  if (body && method !== 'DELETE') {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  handle401(res);
  if (res.status === 409) {
    const err = new Error('Conflict');
    err.status = 409;
    throw err;
  }
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  if (method === 'DELETE') return;
  return res.json();
}

// --- Auth ---

export async function login(pin) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error('Invalid PIN');
  const { token } = await res.json();
  sessionStorage.setItem('token', token);
  return token;
}

export function logout() {
  sessionStorage.removeItem('token');
}

export function isLoggedIn() {
  return !!getToken();
}

// --- Transactions ---

export async function fetchTransactions(month, year) {
  const res = await fetch(`${API_BASE}/transactions?month=${month}&year=${year}`, {
    headers: authHeaders(),
  });
  handle401(res);
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export async function createTransaction(data) {
  return mutate(`${API_BASE}/transactions`, 'POST', data);
}

export async function updateTransaction(id, data) {
  return mutate(`${API_BASE}/transactions/${id}`, 'PUT', data);
}

export async function deleteTransaction(id) {
  return mutate(`${API_BASE}/transactions/${id}`, 'DELETE');
}

// --- Categories ---

export async function fetchCategories() {
  const res = await fetch(`${API_BASE}/categories`, {
    headers: authHeaders(),
  });
  handle401(res);
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
}

export async function createCategory(data) {
  return mutate(`${API_BASE}/categories`, 'POST', data);
}

export async function updateCategory(id, data) {
  return mutate(`${API_BASE}/categories/${id}`, 'PUT', data);
}

export async function deleteCategory(id) {
  return mutate(`${API_BASE}/categories/${id}`, 'DELETE');
}

// --- Accounts ---

export async function fetchAccounts() {
  const res = await fetch(`${API_BASE}/accounts`, {
    headers: authHeaders(),
  });
  handle401(res);
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return res.json();
}

export async function createAccount(data) {
  return mutate(`${API_BASE}/accounts`, 'POST', data);
}

export async function updateAccount(id, data) {
  return mutate(`${API_BASE}/accounts/${id}`, 'PUT', data);
}

export async function deleteAccount(id) {
  return mutate(`${API_BASE}/accounts/${id}`, 'DELETE');
}

// --- Budgets ---

export async function fetchBudget(month, year) {
  const res = await fetch(`${API_BASE}/budgets?month=${month}&year=${year}`, {
    headers: authHeaders(),
  });
  handle401(res);
  if (!res.ok) throw new Error('Failed to fetch budget');
  return res.json();
}

export async function setBudget(data) {
  return mutate(`${API_BASE}/budgets`, 'POST', data);
}

// --- Settings ---

export async function fetchSettings() {
  const res = await fetch(`${API_BASE}/settings`, {
    headers: authHeaders(),
  });
  handle401(res);
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function updateSettings(data) {
  return mutate(`${API_BASE}/settings`, 'PUT', data);
}

// --- Dashboard ---

export async function fetchDashboard(month, year) {
  const res = await fetch(`${API_BASE}/dashboard?month=${month}&year=${year}`, {
    headers: authHeaders(),
  });
  handle401(res);
  if (!res.ok) throw new Error('Failed to fetch dashboard');
  return res.json();
}
