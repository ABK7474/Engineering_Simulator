// Ders analizi: soru dosyalarından çıkarılan kalıplar. LLM her dosyayı ayrı analiz eder (kesilme ve kota riski küçük
// kalsın); bu modül her dosya analizini doğrular (biçim, sayı aralıkları, bilinen tür kimlikleri) ve ders düzeyinde
// KODLA birleştirir: ağırlıklar soru sayısıyla, kalıplar ve öneriler adlarıyla birleşir, öneriler mevcut türlerin
// karşılamadığı soru sayısına göre sıralanır. Analiz tavsiyedir; oyundaki sorulara ve cevaplara dokunmaz.

import { normalizeName } from './format';
import { PROBLEM_CATALOG, type ProblemType } from './problem-catalog';

export const ANALYSIS_VERSION = 1;
export type Fit = 'full' | 'partial' | 'none';

export interface Pattern {
  name: string;
  description: string;
  /** Bu dosyada bu kalıptaki soru sayısı. */
  count: number;
  /** Tipik çözüm adımı. */
  steps: number;
  coveredBy: ProblemType | null;
  fit: Fit;
}
export interface Proposal {
  name: string;
  kind: 'new-type' | 'variant';
  description: string;
  /** Karşıladığı kalıp adları. */
  covers: string[];
  /** 1 (en önemli) … 5. */
  priority: number;
}
export interface FileAnalysis {
  questionCount: number;
  topics: { name: string; weight: number }[];
  steps: { min: number; typical: number; max: number };
  traps: string[];
  ranges: { quantity: string; unit: string; min: number; max: number }[];
  notation: { symbol: string; meaning: string }[];
  patterns: Pattern[];
  proposals: Proposal[];
}

export interface Recommendation {
  rank: number;
  name: string;
  kind: Proposal['kind'];
  description: string;
  covers: string[];
  /** Mevcut türlerin karşılamadığı soru yükü (karşılanmayan 1, kısmen 0,5). */
  uncovered: number;
  priority: number;
  files: number;
}
export interface MergedAnalysis {
  questionCount: number;
  topics: { name: string; weight: number }[];
  steps: { min: number; typical: number; max: number };
  traps: { text: string; files: number }[];
  ranges: { quantity: string; unit: string; min: number; max: number; files: number }[];
  notation: { symbol: string; meaning: string; files: number }[];
  patterns: (Pattern & { files: number })[];
  coverage: Record<Fit, number>;
  recommendations: Recommendation[];
}
export interface CourseAnalysis {
  version: typeof ANALYSIS_VERSION;
  courseId: string;
  courseName: string;
  createdAt: string;
  model: string;
  files: { path: string; sha256: string; analysis: FileAnalysis }[];
  merged: MergedAnalysis;
}

// ---------------------------------------------------------------- doğrulama

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max = 300) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const arr = (x: unknown) => (Array.isArray(x) ? x : []);
const clampInt = (x: unknown, lo: number, hi: number, dflt: number) => {
  const n = num(x);
  return n === null ? dflt : Math.min(hi, Math.max(lo, Math.round(n)));
};
const FITS: Fit[] = ['full', 'partial', 'none'];

/** LLM'in tek dosya analizini doğrular; bozuk girdiler atılır. Hiç soru/kalıp yoksa null. */
export function validateFileAnalysis(raw: unknown): FileAnalysis | null {
  if (!isObj(raw)) return null;
  const patterns: Pattern[] = arr(raw.patterns).flatMap((p) => {
    if (!isObj(p) || !str(p.name)) return [];
    const type = typeof p.coveredBy === 'string' && p.coveredBy in PROBLEM_CATALOG ? (p.coveredBy as ProblemType) : null;
    const fit = type && FITS.includes(p.fit as Fit) ? (p.fit as Fit) : 'none';
    return [{ name: str(p.name, 80), description: str(p.description), count: clampInt(p.count, 1, 500, 1), steps: clampInt(p.steps, 1, 30, 1), coveredBy: fit === 'none' ? null : type, fit }];
  });
  if (!patterns.length) return null;
  const counted = patterns.reduce((a, p) => a + p.count, 0);
  const topicsRaw = arr(raw.topics).flatMap((t) => (isObj(t) && str(t.name) && (num(t.weight) ?? 0) > 0 ? [{ name: str(t.name, 80), weight: num(t.weight)! }] : []));
  const total = topicsRaw.reduce((a, t) => a + t.weight, 0);
  const topics = topicsRaw.map((t) => ({ name: t.name, weight: Math.round((t.weight / total) * 1000) / 10 }));
  const s = isObj(raw.steps) ? raw.steps : {};
  const min = clampInt(s.min, 1, 30, 1);
  const max = Math.max(min, clampInt(s.max, 1, 30, min));
  const ranges = arr(raw.ranges).flatMap((r) => {
    if (!isObj(r) || !str(r.quantity) || num(r.min) === null || num(r.max) === null) return [];
    const [lo, hi] = [num(r.min)!, num(r.max)!].sort((a, b) => a - b);
    return [{ quantity: str(r.quantity, 60), unit: str(r.unit, 20), min: lo, max: hi }];
  });
  const proposals: Proposal[] = arr(raw.proposals).flatMap((p) => {
    if (!isObj(p) || !str(p.name)) return [];
    return [{ name: str(p.name, 80), kind: p.kind === 'variant' ? 'variant' : 'new-type', description: str(p.description, 500), covers: arr(p.covers).map((c) => str(c, 80)).filter(Boolean), priority: clampInt(p.priority, 1, 5, 3) }];
  });
  return {
    questionCount: Math.max(counted, clampInt(raw.questionCount, 1, 1000, counted)),
    topics,
    steps: { min, max, typical: Math.min(max, Math.max(min, clampInt(s.typical, 1, 30, min))) },
    traps: arr(raw.traps).map((t) => str(t)).filter(Boolean).slice(0, 20),
    ranges: ranges.slice(0, 30),
    notation: arr(raw.notation).flatMap((n) => (isObj(n) && str(n.symbol) ? [{ symbol: str(n.symbol, 40), meaning: str(n.meaning, 120) }] : [])).slice(0, 30),
    patterns,
    proposals,
  };
}

// ---------------------------------------------------------------- birleştirme (kod)

const key = (s: string) => normalizeName(s);
const FIT_LOAD: Record<Fit, number> = { full: 0, partial: 0.5, none: 1 };

export function mergeAnalyses(files: readonly FileAnalysis[]): MergedAnalysis {
  const questionCount = files.reduce((a, f) => a + f.questionCount, 0);

  const topicW = new Map<string, { name: string; w: number }>();
  for (const f of files)
    for (const t of f.topics) {
      const e = topicW.get(key(t.name)) ?? { name: t.name, w: 0 };
      e.w += (t.weight / 100) * f.questionCount;
      topicW.set(key(t.name), e);
    }
  const wSum = [...topicW.values()].reduce((a, t) => a + t.w, 0) || 1;
  const topics = [...topicW.values()].map((t) => ({ name: t.name, weight: Math.round((t.w / wSum) * 1000) / 10 })).sort((a, b) => b.weight - a.weight);

  const steps = files.length
    ? {
        min: Math.min(...files.map((f) => f.steps.min)),
        max: Math.max(...files.map((f) => f.steps.max)),
        typical: Math.round(files.reduce((a, f) => a + f.steps.typical * f.questionCount, 0) / (questionCount || 1)),
      }
    : { min: 0, typical: 0, max: 0 };

  const counted = <T>(items: (T & { k: string; file: number })[], merge: (a: T, b: T) => T) => {
    const m = new Map<string, { v: T; files: Set<number> }>();
    for (const it of items) {
      const e = m.get(it.k);
      if (e) {
        e.v = merge(e.v, it);
        e.files.add(it.file);
      } else m.set(it.k, { v: it, files: new Set([it.file]) });
    }
    return [...m.values()].map(({ v, files: fs }) => ({ ...v, files: fs.size }));
  };

  const traps = counted(files.flatMap((f, i) => f.traps.map((text) => ({ text, k: key(text), file: i }))), (a) => a)
    .map(({ text, files: n }) => ({ text, files: n }))
    .sort((a, b) => b.files - a.files);
  const ranges = counted(
    files.flatMap((f, i) => f.ranges.map((r) => ({ ...r, k: `${key(r.quantity)}|${r.unit}`, file: i }))),
    (a, b) => ({ ...a, min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) }),
  ).map(({ quantity, unit, min, max, files: n }) => ({ quantity, unit, min, max, files: n }));
  const notation = counted(files.flatMap((f, i) => f.notation.map((n) => ({ ...n, k: n.symbol, file: i }))), (a) => a)
    .map(({ symbol, meaning, files: n }) => ({ symbol, meaning, files: n }))
    .sort((a, b) => b.files - a.files);

  // Kalıplar: aynı ad birleşir; tür ve uyum soru sayısı en çok olan oya göre
  const pm = new Map<string, { p: Pattern; votes: Map<string, number>; stepsW: number; files: Set<number> }>();
  files.forEach((f, i) =>
    f.patterns.forEach((p) => {
      const e = pm.get(key(p.name)) ?? { p: { ...p, count: 0 }, votes: new Map(), stepsW: 0, files: new Set<number>() };
      e.p.count += p.count;
      e.stepsW += p.steps * p.count;
      const v = `${p.coveredBy ?? ''}|${p.fit}`;
      e.votes.set(v, (e.votes.get(v) ?? 0) + p.count);
      e.files.add(i);
      pm.set(key(p.name), e);
    }),
  );
  const patterns = [...pm.values()]
    .map(({ p, votes, stepsW, files: fs }) => {
      const [type, fit] = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0].split('|');
      return { ...p, steps: Math.round(stepsW / p.count), coveredBy: (type || null) as ProblemType | null, fit: fit as Fit, files: fs.size };
    })
    .sort((a, b) => b.count - a.count);
  const coverage: Record<Fit, number> = { full: 0, partial: 0, none: 0 };
  for (const p of patterns) coverage[p.fit] += p.count;

  // Öneriler: aynı ad birleşir; sıralama karşılanmayan soru yüküne, eşitse ortalama önceliğe göre
  const load = new Map(patterns.map((p) => [key(p.name), p.count * FIT_LOAD[p.fit]]));
  const rm = new Map<string, { p: Proposal; prio: number[]; files: Set<number> }>();
  files.forEach((f, i) =>
    f.proposals.forEach((p) => {
      const e = rm.get(key(p.name)) ?? { p: { ...p, covers: [] }, prio: [], files: new Set<number>() };
      for (const c of p.covers) if (!e.p.covers.some((x) => key(x) === key(c))) e.p.covers.push(c);
      e.prio.push(p.priority);
      e.files.add(i);
      rm.set(key(p.name), e);
    }),
  );
  const recommendations = [...rm.values()]
    .map(({ p, prio, files: fs }) => ({
      name: p.name,
      kind: p.kind,
      description: p.description,
      covers: p.covers,
      uncovered: Math.round(p.covers.reduce((a, c) => a + (load.get(key(c)) ?? 0), 0) * 10) / 10,
      priority: Math.round((prio.reduce((a, b) => a + b, 0) / prio.length) * 10) / 10,
      files: fs.size,
    }))
    .sort((a, b) => b.uncovered - a.uncovered || a.priority - b.priority || a.name.localeCompare(b.name, 'tr'))
    .map((r, i) => ({ rank: i + 1, ...r }));

  return { questionCount, topics, steps, traps, ranges, notation, patterns, coverage, recommendations };
}

export function buildCourseAnalysis(
  course: { id: string; name: string },
  files: CourseAnalysis['files'],
  model: string,
  now = new Date(),
): CourseAnalysis {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  return { version: ANALYSIS_VERSION, courseId: course.id, courseName: course.name, createdAt: now.toISOString(), model, files: sorted, merged: mergeAnalyses(sorted.map((f) => f.analysis)) };
}

/** Kayıttan ya da repodan gelen ders analizi: dosya analizleri yeniden doğrulanır, birleşim yeniden hesaplanır. */
export function parseCourseAnalysis(raw: unknown): CourseAnalysis | null {
  if (!isObj(raw) || raw.version !== ANALYSIS_VERSION || !str(raw.courseId) || !Array.isArray(raw.files)) return null;
  const files = raw.files.flatMap((f) => {
    if (!isObj(f) || !str(f.path, 1000) || !str(f.sha256, 100)) return [];
    const a = validateFileAnalysis(f.analysis);
    return a ? [{ path: str(f.path, 1000), sha256: str(f.sha256, 100), analysis: a }] : [];
  });
  return buildCourseAnalysis({ id: str(raw.courseId), name: str(raw.courseName) || str(raw.courseId) }, files, str(raw.model) || '?', new Date(str(raw.createdAt) || 0));
}

// ---------------------------------------------------------------- okunur .md (repoya yazılır)

const FIT_LABEL: Record<Fit, string> = { full: 'karşılıyor', partial: 'kısmen', none: 'karşılamıyor' };
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function analysisMarkdown(a: CourseAnalysis): string {
  const m = a.merged;
  const pct = (n: number) => (m.questionCount ? `%${Math.round((n / m.questionCount) * 100)}` : '—');
  const L: string[] = [
    `# Ders analizi: ${a.courseName}`,
    '',
    `${a.files.length} dosya, ${m.questionCount} soru · ${a.createdAt.slice(0, 10)} · model: ${a.model}. LLM önerisidir; birleştirme kodla yapılır.`,
    '',
    '## Öneriler (öncelik sırasıyla)',
    '',
    ...(m.recommendations.length
      ? m.recommendations.map((r) => `${r.rank}. **${r.name}** (${r.kind === 'new-type' ? 'yeni tür' : 'soru biçimi'}) — ${r.description} _Karşıladığı kalıplar: ${r.covers.join(', ') || '—'}; karşılanmayan yük ${String(r.uncovered).replace('.', ',')} soru._`)
      : ['Öneri yok.']),
    '',
    `## Kapsama`,
    '',
    `Mevcut türler: ${m.coverage.full} soru tam (${pct(m.coverage.full)}), ${m.coverage.partial} kısmen, ${m.coverage.none} karşılanmıyor.`,
    '',
    '| Kalıp | Soru | Adım | Mevcut tür | Uyum |',
    '|---|---|---|---|---|',
    ...m.patterns.map((p) => `| ${cell(p.name)} | ${p.count} | ${p.steps} | ${p.coveredBy ? PROBLEM_CATALOG[p.coveredBy].label : '—'} | ${FIT_LABEL[p.fit]} |`),
    '',
    '## Konu ağırlığı',
    '',
    ...m.topics.map((t) => `- ${t.name}: %${String(t.weight).replace('.', ',')}`),
    '',
    `## Adım sayısı`,
    '',
    `En az ${m.steps.min}, tipik ${m.steps.typical}, en çok ${m.steps.max}.`,
    '',
    '## Tipik tuzaklar',
    '',
    ...m.traps.map((t) => `- ${t.text}${t.files > 1 ? ` (${t.files} dosyada)` : ''}`),
    '',
    '## Sayı aralıkları',
    '',
    '| Büyüklük | Birim | En az | En çok |',
    '|---|---|---|---|',
    ...m.ranges.map((r) => `| ${cell(r.quantity)} | ${cell(r.unit)} | ${r.min} | ${r.max} |`),
    '',
    '## Hocanın notasyonu',
    '',
    ...m.notation.map((n) => `- \`${n.symbol}\`: ${n.meaning}`),
    '',
    '## Dosyalar',
    '',
    ...a.files.map((f) => `- ${f.path} (${f.analysis.questionCount} soru)`),
    '',
  ];
  return L.join('\n');
}
