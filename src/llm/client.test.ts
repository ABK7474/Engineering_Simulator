// Gemini istemcisi: sahte fetch ile (ağ yok). İstek biçimi, yanıt ayrıştırma, kesilme algılama,
// hata eşleme ve anahtarın hiçbir yere sızmaması.

import { describe, expect, it } from 'vitest';
import { createProvider, DEFAULT_MODEL, ENDPOINT, interpretMarkdown } from './client';
import { LlmError } from './llm';

const KEY = 'AIzaSy-gizli-test-anahtari-123';
const PDF = new TextEncoder().encode('%PDF-1.7 sahte');

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (text: string, status = 'completed') => ({
  id: 'v1_x',
  status,
  steps: [{ type: 'thought', content: [] }, { type: 'model_output', content: [{ type: 'text', text }] }],
});
const provider = (f: typeof fetch) => createProvider({ apiKey: KEY, model: DEFAULT_MODEL, fetch: f });

describe('istek biçimi', () => {
  it('pdfToMarkdown: Interactions uç noktası, anahtar başlıkta, store:false, belge parçası, şema', async () => {
    const { f, calls } = fakeFetch(200, ok(JSON.stringify({ markdown: '# Not', briefing: 'Özet' })));
    await provider(f).pdfToMarkdown(PDF, { courseName: 'Devre Teorisi 1', topicName: 'Seri devre' });
    const { url, init } = calls[0];
    expect(url).toBe(ENDPOINT);
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gemini-3.8-flash');
    expect(body.store).toBe(false);
    expect(body.generation_config.thinking_level).toBe('low');
    expect(body.input[0]).toEqual({ type: 'document', data: btoa('%PDF-1.7 sahte'), mime_type: 'application/pdf' });
    expect(body.input[1].type).toBe('text');
    expect(body.response_format.mime_type).toBe('application/json');
    expect(body.response_format.schema.required).toEqual(['markdown', 'briefing']);
  });

  it('düşünme seviyesi asla "minimal" değil', async () => {
    const { f, calls } = fakeFetch(200, ok('tamam'));
    await provider(f).testConnection();
    expect(JSON.parse(calls[0].init.body as string).generation_config.thinking_level).not.toBe('minimal');
  });

  it('generateTemplates: tür şeması ve .md isteme eklenir', async () => {
    const { f, calls } = fakeFetch(200, ok(JSON.stringify({ candidates: [{ title: 'a' }] })));
    const r = await provider(f).generateTemplates({ type: 'series-led', markdown: '# KONU_MD', courseName: 'D', topicName: 'T', count: 3 });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.input[0].text).toContain('# KONU_MD');
    expect(body.response_format.schema.properties.candidates.maxItems).toBe(3);
    expect(r).toEqual({ candidates: [{ title: 'a' }], truncated: false });
  });
});

describe('yanıt ayrıştırma ve kesilme algılama', () => {
  it('tam yanıt: md ve brifing döner, eksik değil', async () => {
    const { f } = fakeFetch(200, ok(JSON.stringify({ markdown: '# Not\nmetin', briefing: 'Özet' })));
    expect(await provider(f).pdfToMarkdown(PDF, { courseName: 'D', topicName: 'T' })).toEqual({
      markdown: '# Not\nmetin',
      briefing: 'Özet',
      truncated: false,
    });
  });

  it('status "incomplete" (çıktı sınırı): eksik işaretlenir, okunabilen kısım kurtarılır', async () => {
    const half = '{"markdown": "# Uzun not\\nBirinci bölüm\\nİkinci böl';
    const { f } = fakeFetch(200, ok(half, 'incomplete'));
    const r = await provider(f).pdfToMarkdown(PDF, { courseName: 'D', topicName: 'T' });
    expect(r.truncated).toBe(true);
    expect(r.note).toMatch(/çıktı sınırında kesildi/);
    expect(r.markdown).toBe('# Uzun not\nBirinci bölüm\nİkinci böl');
  });

  it('status "completed" ama yarım JSON: yine eksik sayılır (sessizce kabul edilmez)', async () => {
    const { f } = fakeFetch(200, ok('{"markdown": "# Not\\nyar', 'completed'));
    const r = await provider(f).pdfToMarkdown(PDF, { courseName: 'D', topicName: 'T' });
    expect(r.truncated).toBe(true);
    expect(r.markdown).toBe('# Not\nyar');
  });

  it('status "completed" ama boş .md: eksik sayılır', async () => {
    const { f } = fakeFetch(200, ok(JSON.stringify({ markdown: '   ', briefing: 'x' })));
    const r = await provider(f).pdfToMarkdown(PDF, { courseName: 'D', topicName: 'T' });
    expect(r.truncated).toBe(true);
    expect(r.note).toMatch(/boş/);
  });

  it('yarım kaçış dizisinde kesilen metin güvenle kurtarılır', () => {
    expect(interpretMarkdown('{"markdown": "a\\u00', 'incomplete').markdown).toBe('a');
    expect(interpretMarkdown('{"markdown": "tırnak \\" içinde', 'incomplete').markdown).toBe('tırnak " içinde');
  });

  it('şablon yanıtı kesilirse aday yok, eksik işaretli', async () => {
    const { f } = fakeFetch(200, ok('{"candidates": [{"title": "a"', 'incomplete'));
    expect(await provider(f).generateTemplates({ type: 'series-led', markdown: '', courseName: 'D', topicName: 'T', count: 2 })).toEqual({
      candidates: null,
      truncated: true,
    });
  });
});

describe('hata eşleme ve anahtar gizliliği', () => {
  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [404, 'model_unavailable'],
    [429, 'quota'],
    [400, 'bad_request'],
    [503, 'server'],
  ] as const)('HTTP %d → %s', async (status, kind) => {
    const { f } = fakeFetch(status, { error: { message: 'ayrıntı' } });
    const err = await provider(f).pdfToMarkdown(PDF, { courseName: 'D', topicName: 'T' }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.kind).toBe(kind);
    expect(err.message).toContain(`HTTP ${status}`);
  });

  it('400 + "API key not valid" → geçersiz anahtar', async () => {
    const { f } = fakeFetch(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
    const err = await provider(f).generateTemplates({ type: 'series-led', markdown: '', courseName: 'D', topicName: 'T', count: 1 }).catch((e) => e);
    expect(err.kind).toBe('invalid_key');
  });

  it('anahtar hata metninde geçse bile maskelenir', async () => {
    const { f } = fakeFetch(403, { error: { message: `key ${KEY} is blocked` } });
    const err = await provider(f).pdfToMarkdown(PDF, { courseName: 'D', topicName: 'T' }).catch((e) => e);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain('***');
  });

  it('ağ hatası anlaşılır mesaja çevrilir; anahtar sızmaz', async () => {
    const f = (async () => {
      throw new TypeError(`Failed to fetch ${KEY}`);
    }) as unknown as typeof fetch;
    const err = await provider(f).pdfToMarkdown(PDF, { courseName: 'D', topicName: 'T' }).catch((e) => e);
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain(KEY);
  });

  it('bağlantıyı sına: başarı ve başarısızlık', async () => {
    expect((await provider(fakeFetch(200, ok('tamam')).f).testConnection()).ok).toBe(true);
    const bad = await provider(fakeFetch(404, { error: { message: 'model not found' } }).f).testConnection();
    expect(bad).toMatchObject({ ok: false, kind: 'model_unavailable' });
    expect(bad.message).not.toContain(KEY);
  });

  it('JSON olmayan hata gövdesi de işlenir', async () => {
    const { f } = fakeFetch(502, '<html>Bad Gateway</html>');
    const err = await provider(f).pdfToMarkdown(PDF, { courseName: 'D', topicName: 'T' }).catch((e) => e);
    expect(err.kind).toBe('server');
  });
});
