// Stockage local des plantes (IndexedDB). Les photos sont gardées en Blob.

const DB_NAME = 'downmyplant';
const DB_VERSION = 1;
const STORE = 'plants';

let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function listPlants() {
  const all = await tx('readonly', (s) => reqToPromise(s.getAll()));
  return all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function getPlant(id) {
  return tx('readonly', (s) => reqToPromise(s.get(id)));
}

export function savePlant(plant) {
  return tx('readwrite', (s) => reqToPromise(s.put(plant)));
}

export function deletePlant(id) {
  return tx('readwrite', (s) => reqToPromise(s.delete(id)));
}

export function clearPlants() {
  return tx('readwrite', (s) => reqToPromise(s.clear()));
}

// Demande au navigateur de ne pas purger les données (utile sur iOS).
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch { /* ignoré */ }
  return false;
}
