/**
 * Prop videos (intro, break, outro): kept in this browser's IndexedDB so they're there next time, without uploading
 * anything. Mixing happens in this browser, so the files never need to leave it.
 */
export interface PropMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: number;
}

const DB = "7xen-studio";
const STORE = "props";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function listProps(): Promise<PropMeta[]> {
  const all = await tx<{ id: string; name: string; type: string; addedAt: number; blob: Blob }[]>("readonly", (s) => s.getAll());
  return all.map((p) => ({ id: p.id, name: p.name, size: p.blob.size, type: p.type, addedAt: p.addedAt })).sort((a, b) => b.addedAt - a.addedAt);
}

export async function addProp(file: File): Promise<PropMeta> {
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const rec = { id, name: file.name.replace(/\.[^.]+$/, ""), type: file.type, addedAt: Date.now(), blob: file as Blob };
  await tx("readwrite", (s) => s.put(rec));
  return { id, name: rec.name, size: file.size, type: file.type, addedAt: rec.addedAt };
}

export async function getPropBlob(id: string): Promise<Blob | null> {
  const r = await tx<{ blob: Blob } | undefined>("readonly", (s) => s.get(id));
  return r?.blob ?? null;
}

export async function removeProp(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}
