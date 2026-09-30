// Local-first persistence using IndexedDB.
//
// Sydacalist treats the browser as the primary database. Everything here —
// profile settings, drafts, relay lists, UI preferences, cached feed items,
// and the encrypted identity vault — lives in IndexedDB and is never sent to
// a central server. The app should fully reopen and restore its state even
// while offline.

const DB_NAME = 'sydacalist';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

let dbPromise = null;

function hasIndexedDB() {
  return typeof indexedDB !== 'undefined';
}

function openDatabase() {
  if (!hasIndexedDB()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function runTransaction(mode, work) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let result;
        Promise.resolve(work(store))
          .then((value) => {
            result = value;
          })
          .catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Reads a value by key. Returns `undefined` if the key does not exist. */
export async function getItem(key) {
  const record = await runTransaction('readonly', (store) => requestToPromise(store.get(key)));
  return record ? record.value : undefined;
}

/** Writes a JSON-serializable value under a key. */
export async function setItem(key, value) {
  await runTransaction('readwrite', (store) => requestToPromise(store.put({ key, value })));
}

/** Deletes a key. */
export async function removeItem(key) {
  await runTransaction('readwrite', (store) => requestToPromise(store.delete(key)));
}

/** Returns every stored key. Useful for "panic wipe" / export flows. */
export async function getAllKeys() {
  const keys = await runTransaction('readonly', (store) => requestToPromise(store.getAllKeys()));
  return keys || [];
}

/** Wipes all locally stored app data. Irreversible. */
export async function clearAll() {
  await runTransaction('readwrite', (store) => requestToPromise(store.clear()));
}

// --- Named convenience keys -------------------------------------------------
// Centralizing these avoids typos and documents exactly what local-first
// state the app persists.
export const KEYS = {
  IDENTITY_VAULT: 'identity-vault', // encrypted envelope containing the nsec
  PROFILE: 'profile', // public-ish profile metadata (name, bio, theme, widgets)
  RELAYS: 'relays', // list of relay URLs the user has configured
  PREFS: 'prefs', // UI preferences (feed mode, theme, etc.)
  DRAFTS: 'drafts', // unsent draft posts
  FEED_CACHE: 'feed-cache', // last-seen feed events, for offline viewing
  FOLLOWS: 'follows', // pubkeys (hex) the user follows, mirrors the kind-3 list
  PROFILE_CACHE: 'profile-cache', // cached kind-0 metadata for other pubkeys, keyed by hex
  PRIVATE_NOTES: 'private-notes-vault', // encrypted private notes
  DM_CONVERSATIONS: 'dm-conversations-vault', // encrypted NIP-17 direct message history, keyed by peer pubkey
};
