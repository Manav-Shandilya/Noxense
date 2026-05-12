import { describe, it, expect, beforeAll } from 'vitest';

// Import the worker module
import worker from '../src/index.js';

// Pre-computed SHA-256 hash of "1234"
const PIN_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
const AUTH_SECRET = 'test-secret-key-for-hmac';

const env = {
  PIN_HASH,
  AUTH_SECRET,
};

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

async function getJson(response) {
  return response.json();
}

describe('POST /api/login', () => {
  it('returns a token for valid PIN', async () => {
    const req = makeRequest('/api/login', {
      method: 'POST',
      body: { pin: '1234' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.token).toBeDefined();
    expect(data.token).toContain('.');
  });

  it('returns 401 for invalid PIN', async () => {
    const req = makeRequest('/api/login', {
      method: 'POST',
      body: { pin: '9999' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const data = await getJson(res);
    expect(data.error).toBe('Invalid PIN');
  });

  it('returns 400 when PIN is missing', async () => {
    const req = makeRequest('/api/login', {
      method: 'POST',
      body: {},
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    const data = await getJson(res);
    expect(data.error).toBe('PIN is required');
  });

  it('handles numeric PIN input', async () => {
    const req = makeRequest('/api/login', {
      method: 'POST',
      body: { pin: 1234 },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    const data = await getJson(res);
    expect(data.token).toBeDefined();
  });
});

describe('Auth middleware', () => {
  let validToken;

  beforeAll(async () => {
    const req = makeRequest('/api/login', {
      method: 'POST',
      body: { pin: '1234' },
    });
    const res = await worker.fetch(req, env);
    const data = await getJson(res);
    validToken = data.token;
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const req = makeRequest('/api/categories', { method: 'GET' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const data = await getJson(res);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 401 for invalid token', async () => {
    const req = makeRequest('/api/categories', {
      method: 'GET',
      headers: { Authorization: 'Bearer invalid.token' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const data = await getJson(res);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 401 for expired token', async () => {
    // Create a token with an expired timestamp
    const payload = { exp: Date.now() - 1000 };
    const payloadB64 = btoa(JSON.stringify(payload));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(AUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const expiredToken = payloadB64 + '.' + sigHex;

    const req = makeRequest('/api/categories', {
      method: 'GET',
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    const data = await getJson(res);
    expect(data.error).toBe('Unauthorized');
  });

  it('allows access with valid token', async () => {
    const req = makeRequest('/api/categories', {
      method: 'GET',
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const res = await worker.fetch(req, env);
    // Should not be 401 - it will be 404 since categories route isn't implemented yet
    expect(res.status).not.toBe(401);
  });

  it('returns 401 when Bearer prefix is missing', async () => {
    const req = makeRequest('/api/categories', {
      method: 'GET',
      headers: { Authorization: validToken },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });
});

describe('CORS', () => {
  it('responds to OPTIONS with CORS headers', async () => {
    const req = makeRequest('/api/login', { method: 'OPTIONS' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('includes CORS headers in JSON responses', async () => {
    const req = makeRequest('/api/login', {
      method: 'POST',
      body: { pin: '1234' },
    });
    const res = await worker.fetch(req, env);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
