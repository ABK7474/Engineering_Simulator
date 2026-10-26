// ders_materyalleri/ işleme kuyruğu (arayüzden ve ağdan bağımsız; bağımlılıklar dışarıdan verilir, testte sahtesi).
// Kurallar:
// - Sıralı, aynı anda tek LLM isteği.
// - Aynı dosya (yol + sha256) ikinci kez işlenmez; değişen dosya (yeni özet) yeniden işlenir.
// - Uzun PDF (40 sayfa üstü; sayfa bilinmiyorsa 15 MB üstü) kendiliğinden gönderilmez: kullanıcı "yine de işle" demeli.
//   Sağlayıcı sınırını aşan (PDF 50 MB / 1000 sayfa, görsel 20 MB) hiç gönderilmez.
// - Anahtar yoksa oturumda bir kez sorulur; atlanırsa kuyruk "anahtar yok" diye bekler.
// - Kota (429): kuyruk durur, sıradakiler bekler; 60 sn → 2 dk → 5 dk sonra kendiliğinden (ya da "Şimdi dene" ile) devam.
// - Geçersiz anahtar: kuyruk durur. Ağ/sunucu/zaman aşımı: o dosya "hata" olur, diğerleri sürer.
// - Soru dosyası değişince (eklenme, değişme, silinme) dersin analizi dosya analizlerinden yeniden birleştirilir.

import type { FileAnalysis } from '../core/analysis';
import { LONG_PDF_BYTES, LONG_PDF_PAGES, MAX_PDF_BYTES, MAX_PDF_PAGES } from '../core/pdf';
import { LlmError } from '../llm/llm';
import type { MaterialFile, MaterialsListing } from './course-match';

export const QUOTA_WAITS = [60_000, 120_000, 300_000];
/** Satır içi görsel isteğinin üst sınırı. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ItemStatus = 'pending' | 'working' | 'done' | 'long' | 'too-big' | 'failed' | 'no-course' | 'book';
export interface QueueItem {
  file: MaterialFile;
  status: ItemStatus;
  message?: string;
}

export interface ProcessedState {
  notes: Record<string, string>;
  questions: Record<string, { sha256: string; analysis: FileAnalysis }>;
  /** Kullanıcının "yine de işle" dediği uzun dosyalar (yol → özet). */
  forced: Record<string, string>;
  /** Son birleştirilen analizin imzası (ders → dosya özetleri). */
  courseSig: Record<string, string>;
}
export const emptyProcessed = (): ProcessedState => ({ notes: {}, questions: {}, forced: {}, courseSig: {} });

export type Phase = 'idle' | 'working' | 'quota' | 'no-key' | 'invalid-key';
export interface QueueView {
  phase: Phase;
  message: string | null;
  /** Kota beklemesinde yeniden deneme zamanı (ms, deps.now ölçeğinde). */
  resumeAt: number | null;
  /** Ayarlardan geçilebilecek model (kota ya da erişilemeyen model). */
  suggestModel: string | null;
  items: QueueItem[];
  listing: Pick<MaterialsListing, 'unmatched' | 'ignored' | 'splitting'>;
}

export interface QueueDeps {
  readFile: (path: string) => Promise<Uint8Array>;
  /** Not → taslak konu (kütüphaneye yazar). */
  processNote: (file: MaterialFile, bytes: Uint8Array) => Promise<void>;
  /** Soru dosyası → doğrulanmış analiz; yanıt kesildiyse ya da doğrulanamadıysa null. */
  analyzeFile: (file: MaterialFile, bytes: Uint8Array) => Promise<FileAnalysis | null>;
  /** Dersin dosya analizleri birleştirilip yazılsın (boş liste: dersin soru dosyası kalmadı). */
  courseAnalyzed: (courseId: string, files: { path: string; sha256: string; analysis: FileAnalysis }[]) => Promise<void>;
  /** Bu not (yol + özet) kütüphanede ya da repoda zaten var mı. */
  noteKnown: (path: string, sha256: string) => boolean;
  needsKey: () => boolean;
  /** Anahtarı sorar; kaydedildiyse true. */
  askKey: () => Promise<boolean>;
  save: (s: ProcessedState) => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onChange: (v: QueueView) => void;
}

/** Bir dosyanın kuyruktaki ilk durumu (saf). */
export function initialStatus(f: MaterialFile, st: ProcessedState, noteKnown: (p: string, sha: string) => boolean): QueueItem {
  if (!f.courseId) return { file: f, status: 'no-course' };
  if (f.kind === 'book') return { file: f, status: 'book' };
  const done = f.kind === 'notes' ? st.notes[f.path] === f.sha256 || noteKnown(f.path, f.sha256) : st.questions[f.path]?.sha256 === f.sha256;
  if (done) return { file: f, status: 'done' };
  const pdf = /\.pdf$/i.test(f.path);
  if (pdf && (f.bytes > MAX_PDF_BYTES || (f.pages ?? 0) > MAX_PDF_PAGES)) return { file: f, status: 'too-big', message: 'Sağlayıcı sınırını aşıyor (50 MB / 1000 sayfa). Konulara böl.' };
  if (!pdf && f.bytes > MAX_IMAGE_BYTES) return { file: f, status: 'too-big', message: 'Görsel 20 MB sınırını aşıyor.' };
  const long = pdf && (f.pages !== null ? f.pages > LONG_PDF_PAGES : f.bytes > LONG_PDF_BYTES);
  if (long && st.forced[f.path] !== f.sha256) {
    const what = f.pages !== null ? `${f.pages} sayfa` : `${(f.bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
    return { file: f, status: 'long', message: `Uzun PDF (${what}): bölmen önerilir; yanıt kesilebilir ve kota harcar.` };
  }
  return { file: f, status: 'pending' };
}

export const courseSignature = (files: { path: string; sha256: string }[]) =>
  files
    .map((f) => `${f.path}:${f.sha256}`)
    .sort()
    .join('|');

export class MaterialsQueue {
  private items: QueueItem[] = [];
  private listing: QueueView['listing'] = { unmatched: [], ignored: [], splitting: [] };
  private phase: Phase = 'idle';
  private message: string | null = null;
  private suggestModel: string | null = null;
  private resumeAt: number | null = null;
  private strikes = 0;
  private running = false;
  private askedKey = false;
  private failed = new Map<string, string>();
  private wake: (() => void) | null = null;

  constructor(
    private st: ProcessedState,
    private d: QueueDeps,
  ) {}

  view(): QueueView {
    return {
      phase: this.phase,
      message: this.message,
      resumeAt: this.resumeAt,
      suggestModel: this.suggestModel,
      items: this.items.map((i) => ({ ...i })),
      listing: this.listing,
    };
  }
  private emit(): void {
    this.d.onChange(this.view());
  }

  /** Yeni liste (açılışta ve klasör değişince); bekleyen varsa işlemeye başlar. */
  async update(l: MaterialsListing): Promise<void> {
    this.listing = { unmatched: l.unmatched, ignored: l.ignored, splitting: l.splitting };
    const working = this.items.find((i) => i.status === 'working');
    this.items = l.files.map((f) => {
      if (working && working.file.path === f.path && working.file.sha256 === f.sha256) return working;
      const it = initialStatus(f, this.st, this.d.noteKnown);
      const err = this.failed.get(f.path);
      return it.status === 'pending' && err && err.startsWith(`${f.sha256}|`) ? { ...it, status: 'failed', message: err.slice(f.sha256.length + 1) } : it;
    });
    await this.mergeCourses();
    this.emit();
    void this.run();
  }

  /** Uzun dosyayı yine de işle. */
  force(path: string): void {
    const it = this.items.find((i) => i.file.path === path && (i.status === 'long' || i.status === 'failed'));
    if (!it) return;
    if (it.status === 'long') this.st.forced[path] = it.file.sha256;
    this.failed.delete(path);
    it.status = 'pending';
    it.message = undefined;
    void this.d.save(this.st);
    this.emit();
    void this.run();
  }

  /** Kota beklemesini ya da anahtar beklemesini bitir, hemen dene. */
  retryNow(): void {
    if (this.phase === 'no-key' || this.phase === 'invalid-key') {
      this.askedKey = false;
      this.phase = 'idle';
      this.message = null;
    }
    this.resumeAt = null;
    this.wake?.();
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.items.find((i) => i.status === 'pending');
        if (!next) break;
        if (this.phase === 'no-key' || this.phase === 'invalid-key') break;
        if (this.d.needsKey()) {
          if (this.askedKey || !(await this.d.askKey())) {
            this.askedKey = true;
            this.stop('no-key', 'API anahtarı yok: klasördeki dosyalar bekliyor. ⋯ → Ayarlar\'dan ekleyince "Şimdi dene".');
            break;
          }
          this.askedKey = true;
        }
        await this.process(next);
        if (this.phase === 'quota') {
          const wait = QUOTA_WAITS[Math.min(this.strikes - 1, QUOTA_WAITS.length - 1)];
          this.resumeAt = this.d.now() + wait;
          this.emit();
          await Promise.race([this.d.sleep(wait), new Promise<void>((r) => (this.wake = r))]);
          this.wake = null;
          this.resumeAt = null;
          this.phase = 'idle';
          this.message = null;
          this.suggestModel = null;
        }
      }
      if (this.phase === 'working') this.phase = 'idle';
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private stop(phase: Phase, message: string, suggest: string | null = null): void {
    this.phase = phase;
    this.message = message;
    this.suggestModel = suggest;
  }

  private async process(it: QueueItem): Promise<void> {
    const f = it.file;
    it.status = 'working';
    this.phase = 'working';
    this.message = null;
    this.emit();
    try {
      const bytes = await this.d.readFile(f.path);
      if (f.kind === 'notes') {
        await this.d.processNote(f, bytes);
        this.st.notes[f.path] = f.sha256;
      } else {
        const a = await this.d.analyzeFile(f, bytes);
        if (!a) throw new LlmError('bad_response', 'Analiz yanıtı kesildi ya da doğrulanamadı; dosyayı bölüp ya da sonra tekrar dene.');
        this.st.questions[f.path] = { sha256: f.sha256, analysis: a };
      }
      this.strikes = 0;
      it.status = 'done';
      it.message = undefined;
      await this.d.save(this.st);
      if (f.kind === 'questions') await this.mergeCourses();
    } catch (e) {
      const err = e instanceof LlmError ? e : new LlmError('network', (e as Error).message ?? String(e));
      if (err.kind === 'quota') {
        this.strikes++;
        it.status = 'pending';
        const waiting = this.items.filter((i) => i.status === 'pending').length;
        this.stop('quota', `Kota doldu: ${waiting} dosya bekliyor. ${err.message}`, err.suggestModel);
      } else if (err.kind === 'invalid_key' || err.kind === 'no_key') {
        it.status = 'pending';
        this.stop(err.kind === 'no_key' ? 'no-key' : 'invalid-key', err.message);
      } else {
        it.status = 'failed';
        it.message = err.message;
        this.failed.set(f.path, `${f.sha256}|${err.message}`);
        if (err.suggestModel) this.suggestModel = err.suggestModel;
      }
    }
    this.emit();
  }

  /** Soru dosyası kümesi değişen dersler yeniden birleştirilir (silinen dosya da analizden çıkar). */
  private async mergeCourses(): Promise<void> {
    const byCourse = new Map<string, { path: string; sha256: string; analysis: FileAnalysis }[]>();
    for (const c of Object.keys(this.st.courseSig)) byCourse.set(c, []);
    for (const it of this.items) {
      const f = it.file;
      if (f.kind !== 'questions' || !f.courseId) continue;
      const list = byCourse.get(f.courseId) ?? [];
      const done = this.st.questions[f.path];
      if (done && done.sha256 === f.sha256) list.push({ path: f.path, sha256: f.sha256, analysis: done.analysis });
      byCourse.set(f.courseId, list);
    }
    let changed = false;
    for (const [course, files] of byCourse) {
      const sig = courseSignature(files);
      if (this.st.courseSig[course] === sig || (!files.length && !(course in this.st.courseSig))) continue;
      // Bir dersin bütün soru dosyaları henüz işlenmediyse ara birleşim de yazılır (kısmi analiz görünür olsun)
      await this.d.courseAnalyzed(course, files);
      if (files.length) this.st.courseSig[course] = sig;
      else delete this.st.courseSig[course];
      changed = true;
    }
    if (changed) await this.d.save(this.st);
  }
}
