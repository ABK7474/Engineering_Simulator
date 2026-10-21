// İlerleme: kaynaklar, kalıcı hasarlar, bölüm sayacı, onarılan arızalar, izler.
// Tarayıcıda IndexedDB'de durur (altın kural 4); yoksa bellek içi depo ile oturum boyunca sürer.
// Doğrulama/serileştirme saftır ve test edilir.

import type { Balance, Damage, ResourceState } from './resources';
import { openKv, type Kv } from './kv';
import { createResources } from './resources';
import { validThreatState, type ThreatState } from './threat';

export const PROGRESS_VERSION = 3;

/** Kalıcı hasar ve onarım anahtarı: arızanın belirli bir aşaması. */
export const stageKey = (faultId: string, stageIndex: number) => `${faultId}#${stageIndex}`;


/** Dünyadaki ilerleme: bulunulan oda, keşfedilen odalar, sağlanan durumlar, söylenmiş replikler, izler. */
export interface WorldProgress {
  room: string;
  discovered: string[];
  states: string[];
  seenLines: string[];
  /** Yanık izi kalan terminaller (önceki hatalar iz bırakır). */
  scorched: string[];
}

/** Eski (v2) kayıtları dünyaya taşımak için içerikten gelen bilgi. */
export interface MigrationContext {
  startRoom: string;
  /** Dünyadaki arızalar; v2'de arıza anahtarı kart kimliğiydi. */
  faults: { id: string; card: string; provides: string[]; stageCount: number }[];
}

export interface ProgressData {
  version: typeof PROGRESS_VERSION;
  resources: ResourceState;
  episode: number;
  attemptsThisEpisode: number;
  /** Bu bölümde en çok kaynak götüren olay (bölüm kapandı ekranı için). */
  worstEvent: { label: string; total: number } | null;
  /** Arıza başına tamamlanan aşama sayısı; tümü bitince arıza onarılmıştır. */
  faults: Record<string, { stagesDone: number }>;
  world: WorldProgress;
  /** Tehdit olaylarının durumu (tehdit kimliği → durum); eski kayıtlarda yok, boş sayılır. */
  threats: Record<string, ThreatState>;
  savedAt: string;
}

export function defaultProgress(b: Balance, startRoom = ''): ProgressData {
  return {
    version: PROGRESS_VERSION,
    resources: createResources(b),
    episode: 1,
    attemptsThisEpisode: 0,
    worstEvent: null,
    faults: {},
    world: { room: startRoom, discovered: startRoom ? [startRoom] : [], states: [], seenLines: [], scorched: [] },
    threats: {},
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

/**
 * v2 → v3: tek koridordan dünyaya. Arıza anahtarı kart kimliğinden dünya arıza kimliğine çevrilir;
 * tamamlanmış arızanın sağladığı durumlar eklenir; keşfedilen = başlangıç odası; yanık izi o terminale.
 */
function migrateV2(raw: Record<string, unknown>, ctx: MigrationContext): Record<string, unknown> {
  const rename = (key: string) => ctx.faults.find((f) => f.card === key)?.id ?? key;
  const faults: Record<string, unknown> = {};
  const states: string[] = [];
  if (isObj(raw.faults)) {
    for (const [k, v] of Object.entries(raw.faults)) {
      const id = rename(k);
      faults[id] = v;
      const f = ctx.faults.find((x) => x.id === id);
      if (f && isObj(v) && isNum(v.stagesDone) && v.stagesDone >= f.stageCount) for (const s of f.provides) if (!states.includes(s)) states.push(s);
    }
  }
  const r = raw.resources;
  const damages =
    isObj(r) && Array.isArray(r.damages)
      ? r.damages.map((d) => {
          if (!isObj(d) || typeof d.faultId !== 'string') return d;
          const [card, stage] = d.faultId.split('#');
          return { ...d, faultId: stage === undefined ? rename(card) : `${rename(card)}#${stage}` };
        })
      : undefined;
  const scarred = isObj(raw.scars) && raw.scars.panelScorch === true;
  const legacyPanel = Object.keys(raw.faults ?? {}).map(rename)[0];
  const { scars: _drop, ...rest } = raw;
  return {
    ...rest,
    version: 3,
    faults,
    resources: isObj(r) ? { ...r, damages } : r,
    world: { room: ctx.startRoom, discovered: [ctx.startRoom], states, seenLines: [], scorched: scarred && legacyPanel ? [legacyPanel] : [] },
  };
}

/** Ham veriyi doğrular (gerekirse eski sürümden göç ettirir); geçersizse null. */
export function validateProgress(raw: unknown, b: Balance, ctx?: MigrationContext): ProgressData | null {
  if (isObj(raw) && raw.version === 1) raw = migrateV1(raw);
  if (isObj(raw) && raw.version === 2 && ctx) raw = migrateV2(raw, ctx);
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
  const wp = raw.world;
  const strs = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === 'string');
  if (!isObj(wp) || typeof wp.room !== 'string' || !strs(wp.discovered) || !strs(wp.states) || !strs(wp.seenLines) || !strs(wp.scorched)) return null;
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
    world: { room: wp.room, discovered: [...wp.discovered], states: [...wp.states], seenLines: [...wp.seenLines], scorched: [...wp.scorched] },
    threats: isObj(raw.threats) ? Object.fromEntries(Object.entries(raw.threats).filter(([, t]) => validThreatState(t)).map(([k, t]) => [k, { ...(t as ThreatState) }])) : {},
    savedAt: raw.savedAt,
  };
}

// ---------------------------------------------------------------- dışa/içe aktarma biçimi

const EXPORT_TAG = 'derin-muhendis/progress';

/**
 * Yedek: ilerleme + (varsa) konu kütüphanesi. API anahtarı ASLA yedeğe girmez (ayrı yerde durur).
 * Kütüphane alanı olmayan eski yedekler okunmaya devam eder.
 */
export function toExportJson(p: ProgressData, library?: unknown): string {
  return JSON.stringify({ format: EXPORT_TAG, exportedAt: new Date().toISOString(), progress: p, ...(library ? { library } : {}) }, null, 2);
}

function parseBackup(text: string): Record<string, unknown> {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error('Dosya JSON değil.');
  }
  if (!isObj(o) || o.format !== EXPORT_TAG) throw new Error('Bu bir Derin Mühendis ilerleme yedeği değil.');
  return o;
}

/** Yedek dosyasını okur; biçim ya da içerik geçersizse açıklamalı hata fırlatır. */
export function fromExportJson(text: string, b: Balance, ctx?: MigrationContext): ProgressData {
  const p = validateProgress(parseBackup(text).progress, b, ctx);
  if (!p) throw new Error('Yedekteki ilerleme verisi bozuk ya da bu sürümle uyumsuz.');
  return p;
}

/** Yedekteki ham kütüphane (doğrulamayı çağıran yapar); eski yedekte yoksa undefined. */
export function libraryFromExportJson(text: string): unknown {
  return parseBackup(text).library;
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

/** İlerleme, ortak anahtar-değer deposunda 'progress' anahtarı altında durur. */
export function progressStore(kv: Kv): ProgressStore {
  return { kind: kv.kind, load: () => kv.get('progress'), save: (p) => kv.set('progress', p) };
}

/** IndexedDB'yi açar; kullanılamıyorsa bellek içi depoya düşer. */
export async function openProgressStore(): Promise<ProgressStore> {
  return progressStore(await openKv());
}

/** Depodan okur ve doğrular; yoksa ya da bozuksa varsayılan. */
export async function loadProgress(store: ProgressStore, b: Balance, ctx?: MigrationContext): Promise<ProgressData> {
  let raw: unknown;
  try {
    raw = await store.load();
  } catch (e) {
    console.warn('İlerleme okunamadı; varsayılanla başlanıyor.', e);
    return defaultProgress(b, ctx?.startRoom);
  }
  if (raw === undefined) return defaultProgress(b, ctx?.startRoom);
  const p = validateProgress(raw, b, ctx);
  if (!p) console.warn('Kayıtlı ilerleme bozuk ya da eski sürüm; varsayılanla başlanıyor.');
  return p ?? defaultProgress(b, ctx?.startRoom);
}
