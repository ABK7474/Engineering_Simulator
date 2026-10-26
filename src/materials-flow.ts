// ders_materyalleri/ akışı: dev sunucusunun listesini kuyruğa (pipeline/materials-queue.ts) verir, notları mevcut içerik
// hattıyla taslağa çevirir (onay kapısı aynı), soru dosyalarını tek tek analiz edip ders düzeyinde birleştirir, onaylı
// konuları ve analizleri dev sunucusu üzerinden repoya yazar. LLM yalnız tarayıcıda kayıtlı anahtarla çağrılır.
// Yayında (DEV değil) yalnız repodaki analizler gösterilir; klasör izleme ve kuyruk yoktur.

import { buildCourseAnalysis, validateFileAnalysis, type CourseAnalysis } from './core/analysis';
import type { Kv } from './core/kv';
import { replaceDraft, type Library, type Topic } from './core/library';
import { catalogPrompt } from './core/problem-catalog';
import { analyzeQuestions, type LlmSettings } from './llm/llm';
import { mockCalls } from './llm/mock';
import { MIME } from './pipeline/course-match';
import { fetchListing, fetchMaterial, MATERIALS_ENABLED, onMaterialsChanged, repoAnalyses, writeApprovedTopic, writeCourseAnalysis } from './pipeline/materials';
import { courseSignature, emptyProcessed, MaterialsQueue, type ProcessedState, type QueueView } from './pipeline/materials-queue';
import { createTopicDraft, type Course } from './pipeline/topic-pipeline';
import type { FolderDeps } from './ui/library-view';

export interface MaterialsFlowDeps {
  kv: Kv;
  courses: Course[];
  getLibrary: () => Library;
  setLibrary: (lib: Library) => Promise<void>;
  llm: () => LlmSettings;
  needsKey: () => boolean;
  /** Anahtar penceresini açar (oyuncu dolaşırken, panel yokken); kaydedilirse true. */
  askKey: () => Promise<boolean>;
  /** Şu an pencere açılabilir mi (prolog, panel ya da defter açıkken değil). */
  canPrompt: () => boolean;
  saveModel: (model: string) => void;
  /** Ekrandaki kısa durum satırı (null: gizle). */
  onStatus: (text: string | null) => void;
}

export interface MaterialsFlow {
  readonly enabled: boolean;
  start: () => void;
  folder: FolderDeps | null;
  analyses: () => CourseAnalysis[];
  /** Klasörden gelen konu onaylandı ya da şablonları üretildi: repoya yaz. */
  afterApprove: (t: Topic) => Promise<void>;
  /** İnceleme için kaynak PDF (klasör dosyası). */
  pdfFor: (t: Topic) => Promise<Uint8Array | null>;
  debug: { view: () => QueueView; calls: () => typeof mockCalls; refresh: () => Promise<void> };
}

const STATE_KEY = 'materials';
const ANALYSES_KEY = 'analyses';

export async function createMaterialsFlow(d: MaterialsFlowDeps): Promise<MaterialsFlow> {
  const repo = repoAnalyses();
  const local = ((await d.kv.get(ANALYSES_KEY).catch(() => undefined)) ?? {}) as Record<string, CourseAnalysis>;
  const analyses = () => {
    const byCourse = new Map(repo.map((a) => [a.courseId, a]));
    for (const a of Object.values(local)) byCourse.set(a.courseId, a);
    return [...byCourse.values()].sort((a, b) => a.courseName.localeCompare(b.courseName, 'tr'));
  };

  if (!MATERIALS_ENABLED) {
    return {
      enabled: false,
      start: () => {},
      folder: null,
      analyses,
      afterApprove: async () => {},
      pdfFor: async () => null,
      debug: { view: () => ({ phase: 'idle', message: null, resumeAt: null, suggestModel: null, items: [], listing: { unmatched: [], ignored: [], splitting: [] } }), calls: () => mockCalls, refresh: async () => {} },
    };
  }

  const st: ProcessedState = { ...emptyProcessed(), ...(((await d.kv.get(STATE_KEY).catch(() => undefined)) ?? {}) as Partial<ProcessedState>) };
  // Repodaki analizlerin dosyaları işlenmiş sayılır (başka tarayıcıda yeniden gönderilmesin)
  for (const a of [...repo, ...Object.values(local)]) {
    for (const f of a.files) st.questions[f.path] ??= { sha256: f.sha256, analysis: f.analysis };
    st.courseSig[a.courseId] ??= courseSignature(a.files);
  }
  const save = async (s: ProcessedState) => {
    try {
      await d.kv.set(STATE_KEY, s);
    } catch (e) {
      console.warn('Klasör kuyruğu durumu kaydedilemedi.', e);
    }
  };
  const course = (id: string | null) => d.courses.find((c) => c.id === id)!;
  const listeners = new Set<() => void>();
  let repoError: string | null = null;

  const status = (v: QueueView) => {
    const drafts = d.getLibrary().topics.filter((t) => t.origin === 'folder' && t.status === 'draft' && !t.truncated).length;
    const parts: string[] = [];
    if (drafts) parts.push(`${drafts} taslak onay bekliyor`);
    const working = v.items.find((i) => i.status === 'working');
    if (v.phase === 'quota') {
      const n = v.items.filter((i) => i.status === 'pending').length;
      const secs = v.resumeAt !== null ? Math.max(0, Math.ceil((v.resumeAt - Date.now()) / 1000)) : 0;
      parts.push(`kota doldu, ${n} dosya bekliyor (${secs} sn)`);
    } else if (v.phase === 'no-key') parts.push('anahtar yok, dosyalar bekliyor');
    else if (v.phase === 'invalid-key') parts.push('anahtar geçersiz');
    else if (working) parts.push(`işleniyor: ${working.file.name}`);
    const long = v.items.filter((i) => i.status === 'long').length;
    if (long) parts.push(`${long} uzun dosya onayını bekliyor`);
    if (v.listing.unmatched.length) parts.push(`eşleşmeyen klasör: ${v.listing.unmatched.join(', ')}`);
    if (repoError) parts.push(repoError);
    d.onStatus(parts.length ? `Klasör: ${parts.join(' · ')}` : null);
  };

  const queue = new MaterialsQueue(st, {
    readFile: fetchMaterial,
    processNote: async (f, bytes) => {
      const draft = await createTopicDraft(d.llm(), {
        course: course(f.courseId),
        name: f.name,
        fileName: f.path.split('/').pop()!,
        pdf: bytes,
        pages: f.pages,
        folder: { sha256: f.sha256, path: f.path },
      });
      await d.setLibrary(replaceDraft(d.getLibrary(), draft));
    },
    analyzeFile: async (f, bytes) => {
      const r = await analyzeQuestions(d.llm(), { name: f.path.split('/').pop()!, mime: MIME[/\.[^.]+$/.exec(f.path)![0].toLowerCase()], bytes }, { courseName: course(f.courseId).name, catalog: catalogPrompt() });
      return r.truncated ? null : validateFileAnalysis(r.analysis);
    },
    courseAnalyzed: async (courseId, files) => {
      const c = course(courseId);
      const a = files.length ? buildCourseAnalysis({ id: c.id, name: c.name }, files, d.llm().mock ? 'mock' : d.llm().model) : null;
      if (a) local[courseId] = a;
      else delete local[courseId];
      await d.kv.set(ANALYSES_KEY, local).catch((e) => console.warn('Ders analizi kaydedilemedi.', e));
      try {
        await writeCourseAnalysis(courseId, a);
        repoError = null;
      } catch (e) {
        repoError = `analiz repoya yazılamadı (${(e as Error).message})`;
      }
    },
    noteKnown: (p, sha) => d.getLibrary().topics.some((t) => t.source.path === p && t.source.sha256 === sha),
    needsKey: () => !d.llm().mock && d.needsKey(),
    askKey: async () => {
      while (!d.canPrompt()) await new Promise((r) => setTimeout(r, 500));
      return d.askKey();
    },
    save,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    onChange: (v) => {
      status(v);
      listeners.forEach((fn) => fn());
    },
  });
  // Kota geri sayımı durum satırında da aksın
  setInterval(() => queue.view().phase === 'quota' && status(queue.view()), 1000);

  const refresh = async () => {
    const l = await fetchListing();
    if (l) await queue.update(l);
  };

  return {
    enabled: true,
    start: () => {
      void refresh();
      onMaterialsChanged(() => void refresh());
    },
    folder: {
      view: () => queue.view(),
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      force: (p) => queue.force(p),
      retryNow: () => queue.retryNow(),
      useModel: (m) => {
        d.saveModel(m);
        queue.retryNow();
      },
    },
    analyses,
    afterApprove: async (t) => {
      if (t.origin !== 'folder' || t.status !== 'approved') return;
      try {
        await writeApprovedTopic(t);
        repoError = null;
      } catch (e) {
        repoError = `konu repoya yazılamadı (${(e as Error).message})`;
      }
      status(queue.view());
    },
    pdfFor: async (t) => (t.source.path ? fetchMaterial(t.source.path).catch(() => null) : null),
    debug: { view: () => queue.view(), calls: () => mockCalls, refresh },
  };
}
