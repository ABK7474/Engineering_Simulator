// İlerleme: kaynaklar, kalıcı hasarlar, bölüm sayacı, onarılan arızalar, izler.
// Tarayıcıda IndexedDB'de durur (altın kural 4); yoksa bellek içi depo ile oturum boyunca sürer.
// Doğrulama/serileştirme saftır ve test edilir.

import type { Balance, Damage, ResourceState } from './resources';
import { createResources } from './resources';

export const PROGRESS_VERSION = 2;

/** Kalıcı hasar ve onarım anahtarı: arızanın belirli bir aşaması. */
export const stageKey = (faultId: string, stageIndex: number) => `${faultId}#${stageIndex}`;


export interface ProgressData {
  version: typeof PROGRESS_VERSION;
  resources: ResourceState;
  episode: number;
  attemptsThisEpisode: number;
  /** Bu bölümde en çok kaynak götüren olay (bölüm kapandı ekranı için). */
  worstEvent: { label: string; total: number } | null;
  /** Arıza başına tamamlanan aşama sayısı; tümü bitince arıza onarılmıştır. */
  faults: Record<string, { stagesDone: number }>;
  scars: { panelScorch: boolean };
  savedAt: string;
}

export function defaultProgress(b: Balance): ProgressData {
  return {
    version: PROGRESS_VERSION,
    resources: createResources(b),
    episode: 1,
    attemptsThisEpisode: 0,
    worstEvent: null,
    faults: {},
    scars: { panelScorch: false },
    savedAt: new Date(0).toISOString(),
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isAmounts = (x: unknown): x is Record<string, number> => isObj(x) && Object.values(x).every(isNum);

/**
 * v1 → v2: arıza başına `repaired` yerine `stagesDone`; hasar anahtarı arıza#aşama.
 * v1'de her arızanın tek aşaması vardı: onarılmış = yalnız 1. aşama bitti. Sonradan eklenen
 * aşamalar oynanmadan arıza onarılmış sayılmaz.
 */
function migrateV1(raw: Record<string, unknown>): Record<string, unknown> {
  const faults: Record<string, { stagesDone: number }> = {};
  if (isObj(raw.faults)) {
    for (const [id, f] of Object.entries(raw.faults)) {
      if (!isObj(f) || typeof f.repaired !== 'boolean') return { ...raw, faults: null };
      faults[id] = { stagesDone: f.repaired ? 1 : 0 };
    }
  }
  const r = raw.resources;
  const damages =
    isObj(r) && Array.isArray(r.damages)
      ? r.damages.map((d) => (isObj(d) && typeof d.faultId === 'string' && !d.faultId.includes('#') ? { ...d, faultId: stageKey(d.faultId, 0) } : d))
      : r;
  return { ...raw, version: 2, faults, resources: isObj(r) ? { ...r, damages } : r };
}

/** Ham veriyi doğrular (gerekirse eski sürümden göç ettirir); geçersizse null. */
export function validateProgress(raw: unknown, b: Balance): ProgressData | null {
  if (isObj(raw) && raw.version === 1) raw = migrateV1(raw);
  if (!isObj(raw) || raw.version !== PROGRESS_VERSION) return null;
  const r = raw.resources;
  if (!isObj(r) || !isAmounts(r.values) || !isObj(r.warned) || !Array.isArray(r.damages)) return null;
  const ids = Object.keys(b.resources);
  const values = r.values as Record<string, number>;
  // Kaynak listesi denge dosyasıyla birebir aynı olmalı ve değerler aralıkta.
  if (Object.keys(values).length !== ids.length) return null;
  if (!ids.every((id) => isNum(values[id]) && values[id] >= 0 && values[id] <= b.resources[id].max)) return null;
  const damagesOk = (r.damages as unknown[]).every(
    (d) =>
      isObj(d) &&
      typeof d.faultId === 'string' &&
      typeof d.source === 'string' &&
      typeof d.label === 'string' &&
      isAmounts(d.drainPerMinute) &&
      Object.keys(d.drainPerMinute).every((k) => ids.includes(k)),
  );
  if (!damagesOk) return null;
  if (!isNum(raw.episode) || raw.episode < 1 || !isNum(raw.attemptsThisEpisode) || raw.attemptsThisEpisode < 0) return null;
  const w = raw.worstEvent;
  if (w !== null && !(isObj(w) && typeof w.label === 'string' && isNum(w.total))) return null;
  if (!isObj(raw.faults) || !Object.values(raw.faults).every((f) => isObj(f) && isNum(f.stagesDone) && f.stagesDone >= 0)) return null;
  if (!isObj(raw.scars) || typeof raw.scars.panelScorch !== 'boolean') return null;
  if (typeof raw.savedAt !== 'string') return null;
  const warned: Record<string, boolean> = {};
  for (const id of ids) warned[id] = Boolean((r.warned as Record<string, unknown>)[id]);
  return {
    version: PROGRESS_VERSION,
    resources: { values: { ...values }, damages: (r.damages as Damage[]).map((d) => ({ ...d })), warned },
    episode: raw.episode,
    attemptsThisEpisode: raw.attemptsThisEpisode,
    worstEvent: w === null ? null : { label: (w as { label: string }).label, total: (w as { total: number }).total },
    faults: structuredClone(raw.faults) as ProgressData['faults'],
    scars: { panelScorch: raw.scars.panelScorch },
    savedAt: raw.savedAt,
  };
}

// ---------------------------------------------------------------- dışa/içe aktarma biçimi

const EXPORT_TAG = 'derin-muhendis/progress';

export function toExportJson(p: ProgressData): string {
  return JSON.stringify({ format: EXPORT_TAG, exportedAt: new Date().toISOString(), progress: p }, null, 2);
}

/** Yedek dosyasını okur; biçim ya da içerik geçersizse açıklamalı hata fırlatır. */
export function fromExportJson(text: string, b: Balance): ProgressData {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error('Dosya JSON değil.');
  }
  if (!isObj(o) || o.format !== EXPORT_TAG) throw new Error('Bu bir Derin Mühendis ilerleme yedeği değil.');
  const p = validateProgress(o.progress, b);
  if (!p) throw new Error('Yedekteki ilerleme verisi bozuk ya da bu sürümle uyumsuz.');
  return p;
}

// ---------------------------------------------------------------- depolar

export interface ProgressStore {
  readonly kind: 'indexeddb' | 'memory';
  load: () => Promise<unknown>;
  save: (p: ProgressData) => Promise<void>;
}

export class MemoryStore implements ProgressStore {
  readonly kind = 'memory' as const;
  private data: unknown = undefined;
  async load(): Promise<unknown> {
    return this.data === undefined ? undefined : structuredClone(this.data);
  }
  async save(p: ProgressData): Promise<void> {
    this.data = structuredClone(p);
  }
}

const DB = 'derin-muhendis';
const STORE = 'kv';
const KEY = 'progress';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

class IndexedDbStore implements ProgressStore {
  readonly kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {}
  async load(): Promise<unknown> {
    return req(this.db.transaction(STORE).objectStore(STORE).get(KEY));
  }
  async save(p: ProgressData): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(p, KEY);
    await new Promise<void>((ok, fail) => {
      tx.oncomplete = () => ok();
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error);
    });
  }
}

/** IndexedDB'yi açar; kullanılamıyorsa (gizli pencere, eski tarayıcı) bellek içi depoya düşer. */
export async function openProgressStore(): Promise<ProgressStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB yok');
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    return new IndexedDbStore(await req(open));
  } catch (e) {
    console.warn('İlerleme kalıcı saklanamıyor; bu oturumla sınırlı.', e);
    return new MemoryStore();
  }
}

/** Depodan okur ve doğrular; yoksa ya da bozuksa varsayılan. */
export async function loadProgress(store: ProgressStore, b: Balance): Promise<ProgressData> {
  let raw: unknown;
  try {
    raw = await store.load();
  } catch (e) {
    console.warn('İlerleme okunamadı; varsayılanla başlanıyor.', e);
    return defaultProgress(b);
  }
  if (raw === undefined) return defaultProgress(b);
  const p = validateProgress(raw, b);
  if (!p) console.warn('Kayıtlı ilerleme bozuk ya da eski sürüm; varsayılanla başlanıyor.');
  return p ?? defaultProgress(b);
}
