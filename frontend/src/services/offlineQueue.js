const DB_NAME = 'expense-tracker-offline';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';

let db = null;

function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Add a mutation to the offline queue.
 * @param {Object} mutation - { method, url, body }
 */
export async function enqueue(mutation) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record = {
      ...mutation,
      status: 'pending',
      timestamp: Date.now(),
    };
    const request = store.add(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending mutations in order.
 */
export async function getPending() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.getAll();
    request.onsuccess = () => {
      resolve(request.result.filter((r) => r.status === 'pending'));
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all failed mutations.
 */
export async function getFailed() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');
    const request = index.getAll('failed');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Mark a mutation as failed.
 */
async function markFailed(id, error) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.status = 'failed';
        record.error = error;
        store.put(record);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Remove a mutation from the queue.
 */
async function removeMutation(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Dismiss (remove) a failed mutation.
 */
export async function dismissFailed(id) {
  return removeMutation(id);
}

/**
 * Clear all completed/synced mutations.
 */
export async function clearAll() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Replay all pending mutations in order against the API.
 * Returns { synced: number, failed: number }
 */
export async function replay() {
  const pending = await getPending();
  let synced = 0;
  let failed = 0;

  for (const mutation of pending) {
    try {
      const token = sessionStorage.getItem('token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const opts = { method: mutation.method, headers };
      if (mutation.body && mutation.method !== 'GET') {
        opts.body = JSON.stringify(mutation.body);
      }

      const res = await fetch(mutation.url, opts);
      if (res.ok) {
        await removeMutation(mutation.id);
        synced++;
      } else {
        await markFailed(mutation.id, `HTTP ${res.status}`);
        failed++;
      }
    } catch (err) {
      await markFailed(mutation.id, err.message);
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Get the count of pending mutations.
 */
export async function pendingCount() {
  const pending = await getPending();
  return pending.length;
}

/**
 * Check if the browser is online.
 */
export function isOnline() {
  return navigator.onLine;
}

/**
 * Listen for online/offline events.
 * Returns a cleanup function.
 */
export function onConnectivityChange(callback) {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
