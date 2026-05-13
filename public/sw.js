// Service worker for Panini Mundial 2026 Tracker.
// Responsibilities:
//  - Cache the app shell so the UI loads offline after at least one visit.
//  - Drain the offline mutation queue via Background Sync, syncing only the
//    profile the user last marked active on this device. POSTs /api/backup
//    before any mutations are replayed.

const CACHE_NAME = 'panini-2026-v3';
const APP_SHELL = ['/', '/icon.svg', '/manifest.webmanifest'];
const SYNC_TAG = 'panini-sync';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/');
          return Response.error();
        })
      )
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(drainQueue());
});

// --- IndexedDB helpers (mirror of src/idb.js — keep in sync) ---

const DB_NAME = 'panini';
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('pending')) {
        db.createObjectStore('pending', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('pending_profiles')) {
        db.createObjectStore('pending_profiles', { keyPath: 'tempId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllPending() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('pending', 'readonly').objectStore('pending').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deletePending(profileId, code) {
  const db = await openDb();
  const transaction = db.transaction('pending', 'readwrite');
  transaction.objectStore('pending').delete(`${profileId}:${code}`);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getActiveProfileId() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('meta', 'readonly').objectStore('meta').get('activeProfileId');
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => reject(request.error);
  });
}

// --- Drain logic ---

async function drainQueue() {
  const activeProfileId = await getActiveProfileId();
  if (activeProfileId == null) return;

  const allPending = await getAllPending();
  const forActive = allPending.filter((mutation) => mutation.profileId === activeProfileId);
  if (forActive.length === 0) return;

  const backupResponse = await fetch('/api/backup', { method: 'POST' });
  if (!backupResponse.ok) {
    throw new Error('backup failed');
  }

  let failures = 0;
  for (const mutation of forActive) {
    try {
      const response = await fetch(
        `/api/profiles/${mutation.profileId}/stickers/${encodeURIComponent(mutation.code)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: mutation.quantity }),
        }
      );
      if (response.ok) {
        await deletePending(mutation.profileId, mutation.code);
      } else {
        failures += 1;
      }
    } catch (_error) {
      failures += 1;
    }
  }

  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'panini-synced', profileId: activeProfileId });
  }

  if (failures > 0) {
    // Throw so the browser retries the sync with backoff.
    throw new Error(`${failures} mutations failed`);
  }
}
