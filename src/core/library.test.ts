import { describe, expect, it } from 'vitest';
import balanceJson from '../../content/balance/resources.json';
import { MemoryKv } from './kv';
import {
  approveTopic,
  assertCanGenerate,
  BRIEFING_LIMIT,
  emptyLibrary,
  flagTemplate,
  loadLibrary,
  saveLibrary,
  templatePool,
  upsertTopic,
  validateLibrary,
  withTemplates,
  type Topic,
} from './library';
import { checkPdf, inspectPdf, LONG_PDF_BYTES, MAX_PDF_BYTES } from './pdf';
import { defaultProgress, fromExportJson, libraryFromExportJson, toExportJson } from './progress';
import { parseBalance } from './resources';
import type { StageDef } from './types';

const B = parseBalance(balanceJson);

const draft = (patch: Partial<Topic> = {}): Topic => ({
  id: 't1',
  courseId: 'devre-teorisi-1',
  courseName: 'Devre Teorisi 1',
  name: 'Seri devreler',
  status: 'draft',
  markdown: '# Not',
  briefing: 'Özet',
  truncated: false,
  note: null,
  source: { fileName: 'not.pdf', bytes: 1234, pages: 3 },
  model: 'mock',
  createdAt: '2026-10-20T10:00:00.000Z',
  approvedAt: null,
  templates: [],
  report: null,
  ...patch,
});
const stage = (id: string, type: StageDef['type'] = 'series-led'): StageDef => ({ id, type, title: id, briefing: 'b', config: {} });
const report = { total: 1, accepted: 1, rejected: [], truncatedTypes: [] };

describe('onay kuralı', () => {
  it('onaylanmamış konuda şablon üretilemez', () => {
    expect(() => assertCanGenerate(draft())).toThrow(/onaylanmadan/);
    expect(() => withTemplates(draft(), [stage('a')], report)).toThrow(/onaylanmadan/);
  });

  it('onaydan sonra üretilebilir; düzenlenen .md ve brifing saklanır', () => {
    const t = approveTopic(draft(), { markdown: ' # Düzenlendi ', briefing: ' Yeni özet ' }, new Date('2026-10-20T11:00:00Z'));
    expect(t).toMatchObject({ status: 'approved', markdown: '# Düzenlendi', briefing: 'Yeni özet', approvedAt: '2026-10-20T11:00:00.000Z' });
    expect(() => assertCanGenerate(t)).not.toThrow();
    expect(withTemplates(t, [stage('a')], report).templates).toHaveLength(1);
  });

  it('eksik (kesilmiş) .md onaylanamaz', () => {
    expect(() => approveTopic(draft({ truncated: true }), { markdown: '# x', briefing: 'y' })).toThrow(/Eksik/);
  });

  it('boş .md, boş ya da uzun brifing onaylanamaz', () => {
    expect(() => approveTopic(draft(), { markdown: '  ', briefing: 'y' })).toThrow(/boş/);
    expect(() => approveTopic(draft(), { markdown: '# x', briefing: '' })).toThrow(/boş/);
    expect(() => approveTopic(draft(), { markdown: '# x', briefing: 'x'.repeat(BRIEFING_LIMIT + 1) })).toThrow(/en fazla/);
  });
});

describe('havuz ve "bu soru hatalı"', () => {
  const approved = approveTopic(draft(), { markdown: '# x', briefing: 'y' });
  const lib = upsertTopic(emptyLibrary(), withTemplates(approved, [stage('a'), stage('b'), stage('c', 'series-parallel')], report));

  it('havuz türe göre süzülür; taslak konuların şablonu yoktur', () => {
    expect(templatePool(lib, 'series-led').map((s) => s.id)).toEqual(['a', 'b']);
    expect(templatePool(lib, 'series-parallel').map((s) => s.id)).toEqual(['c']);
    expect(templatePool(upsertTopic(emptyLibrary(), draft({ id: 't2' })), 'series-led')).toEqual([]);
  });

  it('işaretlenen şablon havuzdan çıkar, kütüphanede kalır', () => {
    const flagged = flagTemplate(lib, 'a');
    expect(templatePool(flagged, 'series-led').map((s) => s.id)).toEqual(['b']);
    expect(flagged.topics[0].templates.find((x) => x.stage.id === 'a')?.flagged).toBe(true);
  });
});

describe('doğrulama ve depolama', () => {
  it('geçerli kütüphane gidiş-dönüş; bozuk veri reddedilir', () => {
    const lib = upsertTopic(emptyLibrary(), draft());
    expect(validateLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
    expect(validateLibrary(null)).toBeNull();
    expect(validateLibrary({ version: 9, topics: [] })).toBeNull();
    expect(validateLibrary({ version: 1, topics: [{ ...draft(), status: 'yayında' }] })).toBeNull();
    // Kural: eksik .md'li konu onaylı kaydedilemez
    expect(validateLibrary({ version: 1, topics: [draft({ status: 'approved', truncated: true })] })).toBeNull();
  });

  it('depoya kaydedilir ve yüklenir; bozuksa boş kütüphane', async () => {
    const kv = new MemoryKv();
    const lib = upsertTopic(emptyLibrary(), draft());
    await saveLibrary(kv, lib);
    expect(await loadLibrary(kv)).toEqual(lib);
    await kv.set('library', { bozuk: true });
    const warn = console.warn;
    console.warn = () => {};
    expect(await loadLibrary(kv)).toEqual(emptyLibrary());
    console.warn = warn;
  });

  it('yedek: ilerleme + kütüphane; eski yedek (kütüphanesiz) okunur; anahtar yedekte yok', () => {
    const lib = upsertTopic(emptyLibrary(), draft());
    const text = toExportJson(defaultProgress(B), lib);
    expect(validateLibrary(libraryFromExportJson(text))).toEqual(lib);
    expect(fromExportJson(text, B)).toEqual(defaultProgress(B));
    const old = toExportJson(defaultProgress(B));
    expect(libraryFromExportJson(old)).toBeUndefined();
    expect(text).not.toMatch(/apiKey|AIza/);
  });
});

describe('PDF ön denetimi', () => {
  const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7\n${body}`);
  const pages = (n: number) => Array.from({ length: n }, (_, i) => `${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj`).join('\n');

  it('sayfaları sayar; /Pages düğümünü sayfa saymaz', () => {
    expect(inspectPdf(pdf(`2 0 obj << /Type /Pages /Count 3 >> endobj\n${pages(3)}`)).pages).toBe(3);
  });

  it('PDF olmayan dosya engellenir', () => {
    const info = inspectPdf(new TextEncoder().encode('merhaba'));
    expect(info.isPdf).toBe(false);
    expect(checkPdf(info).blocking).toMatch(/PDF değil/);
  });

  it('40 sayfayı aşınca bölme uyarısı, akış engellenmez', () => {
    const c = checkPdf(inspectPdf(pdf(pages(41))));
    expect(c.blocking).toBeNull();
    expect(c.warnings[0]).toMatch(/konulara bölmeniz önerilir/);
    expect(checkPdf(inspectPdf(pdf(pages(40)))).warnings).toEqual([]);
  });

  it('sıkıştırılmış nesne akışında sayım güvenilmez: "sayfa sayısı bilinmiyor", akış sürer', () => {
    const info = inspectPdf(pdf(`5 0 obj << /Type /ObjStm /N 40 >> stream ... endstream\n${pages(2)}`));
    expect(info.pages).toBeNull();
    const c = checkPdf(info);
    expect(c.pagesLabel).toBe('sayfa sayısı bilinmiyor');
    expect(c.blocking).toBeNull();
    expect(c.warnings).toEqual([]);
  });

  it('sayfa bulunamazsa da bilinmiyor; uzunluk uyarısı bu durumda boyuta göre (> 15 MB)', () => {
    const small = inspectPdf(pdf('sayfa nesnesi yok'));
    expect(small.pages).toBeNull();
    expect(checkPdf({ ...small, bytes: LONG_PDF_BYTES - 1 }).warnings).toEqual([]);
    expect(checkPdf({ ...small, bytes: LONG_PDF_BYTES + 1 }).warnings[0]).toMatch(/MB.*konulara bölmeniz önerilir/);
  });

  it('50 MB üstü engellenir', () => {
    expect(checkPdf({ isPdf: true, pages: 10, bytes: MAX_PDF_BYTES + 1 }).blocking).toMatch(/üst sınır/);
  });
});
