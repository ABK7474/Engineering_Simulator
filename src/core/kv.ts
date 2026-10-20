// Tarayıcıda yerel anahtar-değer deposu: IndexedDB (altın kural 4); kullanılamıyorsa
// (gizli pencere, eski tarayıcı) bellek içi depo ile oturum boyunca sürer.

export interface Kv {
  readonly kind: 'indexeddb' | 'memory';
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
}

export class MemoryKv implements Kv {
  readonly kind = 'memory' as const;
  private data = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.data.has(key) ? structuredClone(this.data.get(key)) : undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }
}

const DB = 'derin-muhendis';
const STORE = 'kv';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

class IndexedDbKv implements Kv {
  readonly kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {}
  async get(key: string): Promise<unknown> {
    return req(this.db.transaction(STORE).objectStore(STORE).get(key));
  }
  async set(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    await new Promise<void>((ok, fail) => {
      tx.oncomplete = () => ok();
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error);
    });
  }
}

export async function openKv(): Promise<Kv> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB yok');
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    return new IndexedDbKv(await req(open));
  } catch (e) {
    console.warn('Veriler kalıcı saklanamıyor; bu oturumla sınırlı.', e);
    return new MemoryKv();
  }
}
