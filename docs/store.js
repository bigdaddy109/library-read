/** IndexedDB `library-read` → `ebooks`: downloaded EPUB bytes keyed by Drive file id. Audio is never stored. */

export const DB_NAME = "library-read";
export const DB_VERSION = 1;
export const EBOOK_STORE = "ebooks";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EBOOK_STORE)) db.createObjectStore(EBOOK_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(EBOOK_STORE, mode);
        const req = fn(tx.objectStore(EBOOK_STORE));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

/** @returns {Promise<ArrayBuffer|null>} */
export async function getCachedEbook(key) {
  if (!key) return null;
  try {
    const row = await run("readonly", (store) => store.get(key));
    if (!row) return null;
    if (row.bytes instanceof ArrayBuffer) return row.bytes;
    if (row.blob) return await row.blob.arrayBuffer();
    return null;
  } catch {
    return null;
  }
}

/** Stored as a Blob: iOS Safari keeps Blobs in IndexedDB more reliably than large ArrayBuffers. */
export async function putCachedEbook(key, bytes, meta = {}) {
  if (!key || !bytes) return false;
  try {
    const blob = new Blob([bytes], { type: "application/epub+zip" });
    await run("readwrite", (store) => store.put({ blob, savedAt: Date.now(), ...meta }, key));
    return true;
  } catch {
    return false;
  }
}

export async function clearCachedEbooks() {
  try {
    await run("readwrite", (store) => store.clear());
    return true;
  } catch {
    return false;
  }
}
