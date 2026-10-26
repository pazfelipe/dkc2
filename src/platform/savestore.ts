/** Battery save (SRAM) and quick save states, kept locally in IndexedDB. Nothing is uploaded. */
const DB = "dkc2-remake";
const STORE = "rom"; // store name kept from the ROM-picker days so existing saves still load

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function loadBlob(key: string): Promise<Uint8Array | null> {
  try {
    const db = await open();
    return await new Promise((res) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => res(q.result ? new Uint8Array(q.result) : null);
      q.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
export async function storeBlob(key: string, data: Uint8Array) {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(data.slice().buffer, key);
  } catch {
    /* ignore */
  }
}
/** Older versions kept a copy of the user's ROM under "rom": it is not needed any more. */
export async function deleteBlob(key: string) {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
  } catch {
    /* ignore */
  }
}
