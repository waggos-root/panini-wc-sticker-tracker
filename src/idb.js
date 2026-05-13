// Minimal IndexedDB wrapper for the offline pending queue + meta store.
// Kept in sync (intentionally) with the inlined copy in public/sw.js so both
// the page and the service worker can read/write the same DB.

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

function txDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function getAllPending() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('pending', 'readonly').objectStore('pending').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function putPending(mutation) {
  const db = await openDb();
  const transaction = db.transaction('pending', 'readwrite');
  transaction.objectStore('pending').put({
    ...mutation,
    key: `${mutation.profileId}:${mutation.code}`,
    ts: Date.now(),
  });
  return txDone(transaction);
}

export async function deletePending(profileId, code) {
  const db = await openDb();
  const transaction = db.transaction('pending', 'readwrite');
  transaction.objectStore('pending').delete(`${profileId}:${code}`);
  return txDone(transaction);
}

export async function clearPendingForProfile(profileId) {
  const db = await openDb();
  const transaction = db.transaction('pending', 'readwrite');
  const store = transaction.objectStore('pending');
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      if (cursor.value.profileId === profileId) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getActiveProfileId() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('meta', 'readonly').objectStore('meta').get('activeProfileId');
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function setActiveProfileId(id) {
  const db = await openDb();
  const transaction = db.transaction('meta', 'readwrite');
  transaction.objectStore('meta').put({ key: 'activeProfileId', value: id });
  return txDone(transaction);
}

export async function getAllPendingProfiles() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('pending_profiles', 'readonly').objectStore('pending_profiles').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function putPendingProfile({ tempId, name, emoji }) {
  const db = await openDb();
  const transaction = db.transaction('pending_profiles', 'readwrite');
  transaction.objectStore('pending_profiles').put({ tempId, name, emoji, ts: Date.now() });
  return txDone(transaction);
}

export async function deletePendingProfile(tempId) {
  const db = await openDb();
  const transaction = db.transaction('pending_profiles', 'readwrite');
  transaction.objectStore('pending_profiles').delete(tempId);
  return txDone(transaction);
}

// Move every pending mutation that points at `oldProfileId` to `newProfileId`,
// preserving the latest quantity per sticker.
export async function remapPendingProfileId(oldProfileId, newProfileId) {
  const db = await openDb();
  const transaction = db.transaction('pending', 'readwrite');
  const store = transaction.objectStore('pending');
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      const value = cursor.value;
      if (value.profileId === oldProfileId) {
        cursor.delete();
        store.put({
          ...value,
          profileId: newProfileId,
          key: `${newProfileId}:${value.code}`,
        });
      }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
