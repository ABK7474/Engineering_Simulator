import { describe, expect, it } from 'vitest';
import { validateFileAnalysis, type FileAnalysis } from '../core/analysis';
import { LlmError } from '../llm/llm';
import type { MaterialFile, MaterialsListing } from './course-match';
import { emptyProcessed, MaterialsQueue, QUOTA_WAITS, type ProcessedState, type QueueDeps, type QueueView } from './materials-queue';

const file = (path: string, patch: Partial<MaterialFile> = {}): MaterialFile => ({
  path,
  courseDir: 'Devre Teorisi 1',
  courseId: 'devre-teorisi-1',
  kind: path.includes('/sorular/') ? 'questions' : 'notes',
  fromBook: false,
  name: path,
  bytes: 1000,
  sha256: `sha-${path}`,
  pages: 3,
  ...patch,
});
const listing = (files: MaterialFile[], patch: Partial<MaterialsListing> = {}): MaterialsListing => ({ files, unmatched: [], ignored: [], splitting: [], ...patch });
const A = validateFileAnalysis({ questionCount: 2, patterns: [{ name: 'p', count: 2, steps: 3, coveredBy: 'thevenin', fit: 'full' }] }) as FileAnalysis;

function harness(opts: { key?: boolean; askKey?: boolean; fail?: (path: string, n: number) => Error | null; known?: string[]; st?: ProcessedState } = {}) {
  const log: string[] = [];
  const sleeps: number[] = [];
  const views: QueueView[] = [];
  const merges: { course: string; paths: string[] }[] = [];
  let key = opts.key ?? true;
  let asked = 0;
  const calls = new Map<string, number>();
  const st = opts.st ?? emptyProcessed();
  let releaseSleep: (() => void) | null = null;
  const deps: QueueDeps = {
    readFile: async (p) => new TextEncoder().encode(p),
    processNote: async (f) => {
      const n = (calls.get(f.path) ?? 0) + 1;
      calls.set(f.path, n);
      const err = opts.fail?.(f.path, n);
      if (err) throw err;
      log.push(`not:${f.path}`);
    },
    analyzeFile: async (f) => {
      const n = (calls.get(f.path) ?? 0) + 1;
      calls.set(f.path, n);
      const err = opts.fail?.(f.path, n);
      if (err) throw err;
      log.push(`soru:${f.path}`);
      return A;
    },
    courseAnalyzed: async (course, files) => void merges.push({ course, paths: files.map((f) => f.path) }),
    noteKnown: (p, sha) => (opts.known ?? []).includes(`${p}:${sha}`),
    needsKey: () => !key,
    askKey: async () => {
      asked++;
      if (opts.askKey) key = true;
      return !!opts.askKey;
    },
    save: async () => {},
    now: () => 1000,
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise<void>((r) => (releaseSleep = r));
    },
    onChange: (v) => views.push(v),
  };
  const q = new MaterialsQueue(st, deps);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { q, log, sleeps, views, merges, st, settle, asked: () => asked, release: () => releaseSleep?.(), setKey: (k: boolean) => (key = k) };
}

describe('klasör kuyruğu', () => {
  it('sırayla işler; aynı dosya (yol + özet) tekrar işlenmez, değişen dosya yeniden işlenir', async () => {
    const h = harness();
    const n1 = file('D/notlar/a.pdf');
    await h.q.update(listing([n1, file('D/sorular/vize.pdf')]));
    await h.settle();
    expect(h.log).toEqual(['not:D/notlar/a.pdf', 'soru:D/sorular/vize.pdf']);
    await h.q.update(listing([n1, file('D/sorular/vize.pdf')]));
    await h.settle();
    expect(h.log).toHaveLength(2);
    await h.q.update(listing([{ ...n1, sha256: 'yeni' }, file('D/sorular/vize.pdf')]));
    await h.settle();
    expect(h.log).toEqual(['not:D/notlar/a.pdf', 'soru:D/sorular/vize.pdf', 'not:D/notlar/a.pdf']);
    expect(h.q.view().items.every((i) => i.status === 'done')).toBe(true);
  });

  it('kütüphanede ya da repoda olan not atlanır; eşleşmeyen ders ve kitap işlenmez', async () => {
    const h = harness({ known: ['D/notlar/a.pdf:sha-D/notlar/a.pdf'] });
    await h.q.update(listing([file('D/notlar/a.pdf'), file('X/notlar/b.pdf', { courseId: null }), file('D/kitaplar/k.pdf', { kind: 'book' })], { unmatched: ['X'] }));
    await h.settle();
    expect(h.log).toEqual([]);
    expect(h.q.view().items.map((i) => i.status)).toEqual(['done', 'no-course', 'book']);
    expect(h.q.view().listing.unmatched).toEqual(['X']);
  });

  it('uzun PDF kendiliğinden gönderilmez; "yine de işle" ile gider. Sınırı aşan hiç gitmez', async () => {
    const h = harness();
    await h.q.update(
      listing([
        file('D/notlar/uzun.pdf', { pages: 90 }),
        file('D/notlar/bilinmeyen.pdf', { pages: null, bytes: 16 * 1024 * 1024 }),
        file('D/notlar/dev.pdf', { pages: 1200 }),
        file('D/sorular/foto.png', { pages: null, bytes: 21 * 1024 * 1024 }),
      ]),
    );
    await h.settle();
    expect(h.q.view().items.map((i) => i.status)).toEqual(['long', 'long', 'too-big', 'too-big']);
    expect(h.q.view().items[0].message).toMatch(/90 sayfa/);
    h.q.force('D/notlar/uzun.pdf');
    await h.settle();
    expect(h.log).toEqual(['not:D/notlar/uzun.pdf']);
    expect(h.st.forced['D/notlar/uzun.pdf']).toBe('sha-D/notlar/uzun.pdf');
  });

  it('kota (429): kuyruk durur, sıradakiler bekler, 60 sn → 2 dk → 5 dk; sonra devam eder ve hafif model önerilir', async () => {
    const h = harness({ fail: (p, n) => (p.endsWith('a.pdf') && n <= 3 ? new LlmError('quota', 'Kota [HTTP 429]', 'hafif-model') : null) });
    await h.q.update(listing([file('D/notlar/a.pdf'), file('D/notlar/b.pdf')]));
    await h.settle();
    let v = h.q.view();
    expect(v.phase).toBe('quota');
    expect(v.message).toMatch(/2 dosya bekliyor/);
    expect(v.suggestModel).toBe('hafif-model');
    expect(v.resumeAt).toBe(1000 + QUOTA_WAITS[0]);
    expect(h.log).toEqual([]);
    for (let k = 0; k < 3; k++) {
      h.release();
      await h.settle();
    }
    expect(h.sleeps).toEqual(QUOTA_WAITS);
    v = h.q.view();
    expect(v.phase).toBe('idle');
    expect(h.log).toEqual(['not:D/notlar/a.pdf', 'not:D/notlar/b.pdf']);
  });

  it('"Şimdi dene" kota beklemesini keser', async () => {
    const h = harness({ fail: (_p, n) => (n === 1 ? new LlmError('quota', '429') : null) });
    await h.q.update(listing([file('D/notlar/a.pdf')]));
    await h.settle();
    expect(h.q.view().phase).toBe('quota');
    h.q.retryNow();
    await h.settle();
    expect(h.log).toEqual(['not:D/notlar/a.pdf']);
  });

  it('anahtar yoksa bir kez sorulur; atlanırsa bekler, tekrar sormaz; anahtar eklenince "Şimdi dene" ile sürer', async () => {
    const h = harness({ key: false, askKey: false });
    await h.q.update(listing([file('D/notlar/a.pdf')]));
    await h.settle();
    expect(h.asked()).toBe(1);
    expect(h.q.view().phase).toBe('no-key');
    await h.q.update(listing([file('D/notlar/a.pdf'), file('D/notlar/b.pdf')]));
    await h.settle();
    expect(h.asked()).toBe(1);
    expect(h.log).toEqual([]);
    h.setKey(true);
    h.q.retryNow();
    await h.settle();
    expect(h.log).toEqual(['not:D/notlar/a.pdf', 'not:D/notlar/b.pdf']);
  });

  it('geçersiz anahtar kuyruğu durdurur; ağ hatası yalnız o dosyayı "hata" yapar, aynı sürümü kendiliğinden yeniden denemez', async () => {
    const bad = harness({ fail: () => new LlmError('invalid_key', 'API anahtarı geçersiz') });
    await bad.q.update(listing([file('D/notlar/a.pdf'), file('D/notlar/b.pdf')]));
    await bad.settle();
    expect(bad.q.view().phase).toBe('invalid-key');
    expect(bad.q.view().items.map((i) => i.status)).toEqual(['pending', 'pending']);

    const net = harness({ fail: (p) => (p.endsWith('a.pdf') ? new LlmError('timeout', 'yanıt yok') : null) });
    await net.q.update(listing([file('D/notlar/a.pdf'), file('D/notlar/b.pdf')]));
    await net.settle();
    expect(net.q.view().items.map((i) => [i.status, i.message ?? ''])).toEqual([
      ['failed', 'yanıt yok'],
      ['done', ''],
    ]);
    await net.q.update(listing([file('D/notlar/a.pdf'), file('D/notlar/b.pdf')]));
    await net.settle();
    expect(net.q.view().items[0].status).toBe('failed');
    expect(net.log).toEqual(['not:D/notlar/b.pdf']);
  });

  it('ders analizi: her soru dosyası ayrı işlenir, birleşim dosya kümesi değişince yeniden; silinen dosya analizden çıkar', async () => {
    const h = harness();
    const v = file('D/sorular/vize.pdf');
    const f = file('D/sorular/final.pdf');
    await h.q.update(listing([v, f]));
    await h.settle();
    expect(h.log).toEqual(['soru:D/sorular/vize.pdf', 'soru:D/sorular/final.pdf']);
    expect(h.merges.at(-1)).toEqual({ course: 'devre-teorisi-1', paths: ['D/sorular/vize.pdf', 'D/sorular/final.pdf'] });
    const before = h.merges.length;
    await h.q.update(listing([v, f]));
    await h.settle();
    expect(h.merges).toHaveLength(before);
    await h.q.update(listing([v]));
    await h.settle();
    expect(h.merges.at(-1)).toEqual({ course: 'devre-teorisi-1', paths: ['D/sorular/vize.pdf'] });
    await h.q.update(listing([]));
    await h.settle();
    expect(h.merges.at(-1)).toEqual({ course: 'devre-teorisi-1', paths: [] });
  });
});
