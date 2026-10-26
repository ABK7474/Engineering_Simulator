// Konu kütüphanesi: ders > konu > {.md, brifing özeti, doğrulanmış şablonlar}.
// Tarayıcıda (ortak anahtar-değer deposunda 'library' anahtarı) durur; yedeğe dahildir.
// Kural: kullanıcı .md'yi onaylamadan şablon üretilmez; eksik (kesilmiş) .md onaylanamaz.

import type { Kv } from './kv';
import type { StageDef } from './types';

export const LIBRARY_VERSION = 1;
export const BRIEFING_LIMIT = 600;

export interface TopicTemplate {
  stage: StageDef;
  /** Oyuncu "bu soru hatalı" dedi: havuzdan çıkar, kütüphanede kalır. */
  flagged: boolean;
  createdAt: string;
}

export interface TemplateReport {
  total: number;
  accepted: number;
  rejected: { type: string; index: number; reason: string }[];
  /** Yanıtı kesilen türler (aday alınamadı). */
  truncatedTypes: string[];
}

export interface Topic {
  id: string;
  courseId: string;
  courseName: string;
  name: string;
  status: 'draft' | 'approved';
  markdown: string;
  briefing: string;
  /** Formül sayfası (Markdown); onaylanınca defterde konu sayfası olur. */
  formulaSheet: string;
  /** LLM yanıtı kesildi ya da eksik: onaylanamaz. */
  truncated: boolean;
  note: string | null;
  source: {
    fileName: string;
    bytes: number;
    pages: number | null;
    /** Klasörden gelen dosyanın içerik özeti (aynı dosya yeniden işlenmez) ve ders_materyalleri/'ne göre yolu. */
    sha256?: string;
    path?: string;
  };
  /** upload: "Konu ekle"; folder: ders_materyalleri/ klasörü; repo: content/library/ (yayındaki onaylı içerik). */
  origin?: 'upload' | 'folder' | 'repo';
  model: string;
  createdAt: string;
  approvedAt: string | null;
  templates: TopicTemplate[];
  report: TemplateReport | null;
}

export interface Library {
  version: typeof LIBRARY_VERSION;
  topics: Topic[];
}

export const emptyLibrary = (): Library => ({ version: LIBRARY_VERSION, topics: [] });

// ---------------------------------------------------------------- kurallar

export interface ApproveEdits {
  markdown: string;
  briefing: string;
  formulaSheet?: string;
  name?: string;
}

export function approveTopic(t: Topic, edits: ApproveEdits, now = new Date()): Topic {
  if (t.truncated) throw new Error('Eksik (kesilmiş) .md onaylanamaz; yeniden üret ya da PDF\'i böl.');
  const markdown = edits.markdown.trim();
  const briefing = edits.briefing.trim();
  const name = (edits.name ?? t.name).trim();
  if (!markdown) throw new Error('.md boş; onaylanamaz.');
  if (!briefing) throw new Error('Brifing özeti boş; onaylanamaz.');
  if (!name) throw new Error('Konu adı boş; onaylanamaz.');
  if (briefing.length > BRIEFING_LIMIT) throw new Error(`Brifing özeti en fazla ${BRIEFING_LIMIT} karakter olmalı.`);
  return { ...t, name, markdown, briefing, formulaSheet: (edits.formulaSheet ?? t.formulaSheet).trim(), status: 'approved', approvedAt: now.toISOString() };
}

/**
 * Klasörden gelen konu onaylanınca aynı dosyanın (yolun) eski sürümleri kütüphaneden çıkar; değişen dosyanın yeni
 * taslağı onaylanana kadar eski onaylı sürüm oyunda kalır.
 */
export function supersede(lib: Library, t: Topic): Library {
  const p = t.source.path;
  const rest = p && t.status === 'approved' ? lib.topics.filter((x) => x.id === t.id || x.source.path !== p) : lib.topics;
  return upsertTopic({ ...lib, topics: rest }, t);
}

/** Klasörden yeniden işlenen dosya: aynı yolun onaysız taslağı yenisiyle değişir (onaylı sürüm kalır). */
export function replaceDraft(lib: Library, t: Topic): Library {
  const rest = lib.topics.filter((x) => !(x.status === 'draft' && x.source.path && x.source.path === t.source.path));
  return upsertTopic({ ...lib, topics: rest }, t);
}

/** Kitaptan gelen not: tam metin repoya yazılmaz (telif). */
export const isFromBook = (t: Topic) => /(^|\/)kitaplar\//i.test(t.source.path ?? '');

/** Repoya yazılacak hâl: yalnız onaylı; kitaptan gelende .md çıkarılır, brifing/formül/şablonlar kalır. */
export function toRepoTopic(t: Topic): Topic {
  if (t.status !== 'approved') throw new Error('Onaylanmamış konu repoya yazılmaz.');
  const book = isFromBook(t);
  return {
    ...t,
    origin: 'repo',
    markdown: book ? '' : t.markdown,
    note: book ? 'Kitaptan: tam not repoda tutulmaz (telif); brifing, formül sayfası ve şablonlar burada.' : t.note,
  };
}

/**
 * Repodaki onaylı konular (content/library/) kütüphaneye eklenir. Aynı kimlik kütüphanede varsa (bu tarayıcıda
 * onaylanmış) o kalır; aynı dosyanın daha yeni onaylı sürümü varsa repo sürümü eklenmez.
 */
export function withRepoTopics(lib: Library, repo: readonly Topic[]): Library {
  const have = new Set(lib.topics.map((t) => t.id));
  const approvedPaths = new Set(lib.topics.filter((t) => t.status === 'approved' && t.source.path).map((t) => t.source.path));
  const add = repo.filter((t) => !have.has(t.id) && !(t.source.path && approvedPaths.has(t.source.path)));
  return add.length ? { ...lib, topics: [...lib.topics, ...add.map((t) => ({ ...t, origin: 'repo' as const }))] } : lib;
}

/** Ham repo dosyası → onaylı konu (geçersizse null). */
export function parseRepoTopic(raw: unknown): Topic | null {
  if (!validTopic(raw) || raw.status !== 'approved') return null;
  return migrateTopic(structuredClone(raw));
}

/** Şablon üretimi yalnız onaylanmış konuda. */
export function assertCanGenerate(t: Topic): void {
  if (t.status !== 'approved') throw new Error('Konu onaylanmadan şablon üretilemez.');
}

export function withTemplates(t: Topic, stages: StageDef[], report: TemplateReport, now = new Date()): Topic {
  assertCanGenerate(t);
  return { ...t, templates: [...t.templates, ...stages.map((stage) => ({ stage, flagged: false, createdAt: now.toISOString() }))], report };
}

export function upsertTopic(lib: Library, t: Topic): Library {
  return { ...lib, topics: [...lib.topics.filter((x) => x.id !== t.id), t] };
}

export function removeTopic(lib: Library, id: string): Library {
  return { ...lib, topics: lib.topics.filter((x) => x.id !== id) };
}

export function flagTemplate(lib: Library, stageId: string): Library {
  return {
    ...lib,
    topics: lib.topics.map((t) => ({ ...t, templates: t.templates.map((x) => (x.stage.id === stageId ? { ...x, flagged: true } : x)) })),
  };
}

/** Oyunda kullanılabilecek kullanıcı şablonları: onaylı konular, işaretlenmemiş, verilen tür. */
export function templatePool(lib: Library, type: StageDef['type']): StageDef[] {
  return lib.topics
    .filter((t) => t.status === 'approved')
    .flatMap((t) => t.templates)
    .filter((x) => !x.flagged && x.stage.type === type)
    .map((x) => x.stage);
}

// ---------------------------------------------------------------- doğrulama ve depolama

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

function validTemplate(x: unknown): x is TopicTemplate {
  if (!isObj(x) || typeof x.flagged !== 'boolean' || !isStr(x.createdAt) || !isObj(x.stage)) return false;
  const s = x.stage;
  return isStr(s.id) && (s.type === 'series-led' || s.type === 'series-parallel') && isStr(s.title) && isStr(s.briefing) && isObj(s.config);
}

function validTopic(x: unknown): x is Topic {
  if (!isObj(x)) return false;
  const src = x.source;
  return (
    isStr(x.id) &&
    isStr(x.courseId) &&
    isStr(x.courseName) &&
    isStr(x.name) &&
    (x.status === 'draft' || x.status === 'approved') &&
    isStr(x.markdown) &&
    isStr(x.briefing) &&
    (x.formulaSheet === undefined || isStr(x.formulaSheet)) &&
    (x.origin === undefined || x.origin === 'upload' || x.origin === 'folder' || x.origin === 'repo') &&
    typeof x.truncated === 'boolean' &&
    (x.note === null || isStr(x.note)) &&
    isObj(src) &&
    isStr(src.fileName) &&
    typeof src.bytes === 'number' &&
    (src.pages === null || typeof src.pages === 'number') &&
    (src.sha256 === undefined || isStr(src.sha256)) &&
    (src.path === undefined || isStr(src.path)) &&
    isStr(x.model) &&
    isStr(x.createdAt) &&
    (x.approvedAt === null || isStr(x.approvedAt)) &&
    Array.isArray(x.templates) &&
    x.templates.every(validTemplate) &&
    (x.report === null || isObj(x.report)) &&
    // Kural: eksik .md'li konu onaylı olamaz
    !(x.status === 'approved' && x.truncated)
  );
}

/** Ham veriyi doğrular; geçersizse null. Şablonların tür yapılandırması ayrıca yüklenirken doğrulanır. */
export function validateLibrary(raw: unknown): Library | null {
  if (!isObj(raw) || raw.version !== LIBRARY_VERSION || !Array.isArray(raw.topics)) return null;
  if (!raw.topics.every(validTopic)) return null;
  return migrateTags(structuredClone(raw) as unknown as Library);
}

/** Etiketlerden önceki kayıtlar: şablon aşamasına konunun dersi ve konu kimliği eklenir; formül sayfasından önceki
 * kayıtlara boş sayfa. */
export function migrateTags(lib: Library): Library {
  lib.topics.forEach(migrateTopic);
  return lib;
}
function migrateTopic(t: Topic): Topic {
  t.formulaSheet ??= '';
  for (const x of t.templates) {
    x.stage.course ??= t.courseId;
    x.stage.topic ??= `konu:${t.id}`;
  }
  return t;
}

export async function loadLibrary(kv: Kv): Promise<Library> {
  let raw: unknown;
  try {
    raw = await kv.get('library');
  } catch (e) {
    console.warn('Konu kütüphanesi okunamadı.', e);
    return emptyLibrary();
  }
  if (raw === undefined) return emptyLibrary();
  const lib = validateLibrary(raw);
  if (!lib) console.warn('Kayıtlı konu kütüphanesi bozuk; boş kütüphaneyle başlanıyor.');
  return lib ?? emptyLibrary();
}

export const saveLibrary = (kv: Kv, lib: Library): Promise<void> => kv.set('library', lib);
