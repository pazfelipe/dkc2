/** Keeps the user's ROM in IndexedDB so it only has to be picked once. Nothing is uploaded. */
const DB = "dkc2-remake";
const STORE = "rom";
export const EXPECTED_SHA256 = "b79c2bb86f6fc76e1fc61c62fc16d51c664c381e58bc2933be643bbc4d8b610c"; // USA Rev 1, headerless

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function loadStoredRom(): Promise<Uint8Array | null> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const q = db.transaction(STORE).objectStore(STORE).get("rom");
      q.onsuccess = () => res(q.result ? new Uint8Array(q.result) : null);
      q.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

export async function storeRom(rom: Uint8Array) {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(rom.buffer.slice(0), "rom");
  } catch {
    /* private mode: keep in memory only */
  }
}

export async function sha256(data: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strip a 512-byte copier header if present. */
export function normalizeRom(data: Uint8Array): Uint8Array {
  return data.length % 1024 === 512 ? data.slice(512) : data;
}
