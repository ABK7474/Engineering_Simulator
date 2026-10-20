// Gemini'yi bilen TEK dosya (altın kural 3). Interactions API, düz fetch.
// Kararlar (Google'ın güncel dokümanından, Ekim 2026):
// - Uç nokta: POST /v1beta/interactions (GA, yeni projeler için önerilen API).
// - Model: varsayılan gemini-3.8-flash; ayarlardan değiştirilebilir (isim eskiyince kod değişmez).
// - PDF satır içi base64 `document` parçası olarak gider; Gemini sayfaları görüyle okur (şemalar dahil).
// - Yapılandırılmış çıktı: response_format + JSON şeması; değerler yine de kodda doğrulanır.
// - store:false → istek/yanıt Google tarafında etkileşim olarak saklanmaz.
// - thinking_level "low" (3.8 Flash "minimal"i kabul etmiyor; düşünme token'ları çıktı bütçesinden yer).
// - Anahtar yalnız x-goog-api-key başlığında; URL'de, log'da, hata metninde asla yer almaz.

import type { ConnectionCheck, LlmErrorKind, LlmProvider, MarkdownResult, TemplateRequest, TemplateResult } from './llm';
import { LlmError } from './llm';
import { MARKDOWN_SCHEMA, markdownPrompt, templatePrompt, templateSchema } from './prompts';

export const PROVIDER_LABEL = 'Gemini';
export const DEFAULT_MODEL = 'gemini-3.8-flash';
/** Anahtar ekranında gösterilen, sağlayıcıya özgü güvenlik önerisi. */
export const KEY_ADVICE = 'Öneri: anahtarı Google AI Studio\'da "yalnız Gemini API" ve web sitesi (HTTP referrer) kısıtıyla sınırla.';
export const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const THINKING_LEVEL = 'low';

type Fetch = typeof fetch;

interface Part {
  type: string;
  text?: string;
}
interface InteractionResponse {
  status?: string;
  steps?: { type?: string; content?: Part[] }[];
  error?: { message?: string; status?: string };
}

export function createProvider(opts: { apiKey: string; model: string; fetch?: Fetch }): LlmProvider {
  const { apiKey, model } = opts;
  const doFetch: Fetch = opts.fetch ?? ((...a) => fetch(...a));
  const mask = (s: string) => (apiKey ? s.split(apiKey).join('***') : s);

  async function call(body: Record<string, unknown>): Promise<{ text: string; status: string }> {
    let res: Response;
    try {
      res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ model, store: false, generation_config: { thinking_level: THINKING_LEVEL }, ...body }),
      });
    } catch (e) {
      throw new LlmError('network', mask(`${PROVIDER_LABEL}'e ulaşılamadı (ağ hatası): ${e instanceof Error ? e.message : String(e)}`));
    }
    let json: InteractionResponse | null = null;
    try {
      json = (await res.json()) as InteractionResponse;
    } catch {
      json = null;
    }
    if (!res.ok) throw httpError(res.status, mask(json?.error?.message ?? res.statusText ?? ''));
    if (!json) throw new LlmError('bad_response', `${PROVIDER_LABEL} yanıtı JSON değil.`);
    const text = (json.steps ?? [])
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content ?? [])
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text!)
      .join('');
    return { text, status: json.status ?? 'completed' };
  }

  return {
    label: PROVIDER_LABEL,
    model,
    async pdfToMarkdown(pdf, ctx): Promise<MarkdownResult> {
      const { text, status } = await call({
        input: [
          // Doküman: tek belgede metin istemi belgeden sonra gelsin.
          { type: 'document', data: toBase64(pdf), mime_type: 'application/pdf' },
          { type: 'text', text: markdownPrompt(ctx.courseName, ctx.topicName) },
        ],
        response_format: { type: 'text', mime_type: 'application/json', schema: MARKDOWN_SCHEMA },
      });
      return interpretMarkdown(text, status);
    },
    async generateTemplates(req: TemplateRequest): Promise<TemplateResult> {
      const { text, status } = await call({
        input: [{ type: 'text', text: `${templatePrompt(req.type, req.courseName, req.topicName, req.count)}\n${req.markdown}` }],
        response_format: { type: 'text', mime_type: 'application/json', schema: templateSchema(req.type, req.count) },
      });
      if (status === 'incomplete') return { candidates: null, truncated: true };
      try {
        const parsed = JSON.parse(text) as { candidates?: unknown };
        return { candidates: parsed?.candidates ?? null, truncated: false };
      } catch {
        return { candidates: null, truncated: true };
      }
    },
    async testConnection(): Promise<ConnectionCheck> {
      try {
        await call({ input: [{ type: 'text', text: 'Bağlantı denemesi. Yalnız "tamam" yaz.' }] });
        return { ok: true, kind: 'ok', message: `Bağlantı tamam: anahtar geçerli, ${model} erişilebilir.` };
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError('network', mask(String(e)));
        return { ok: false, kind: err.kind, message: err.message };
      }
    },
  };
}

function httpError(status: number, detail: string): LlmError {
  const d = detail ? ` (${detail})` : '';
  const map: [boolean, LlmErrorKind, string][] = [
    [status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(detail)), 'invalid_key', 'API anahtarı geçersiz ya da bu işleme yetkisi yok'],
    [status === 404, 'model_unavailable', 'Model bulunamadı ya da bu anahtarla erişilemiyor; Ayarlar\'dan model adını kontrol et'],
    [status === 429, 'quota', 'Kota ya da hız sınırı aşıldı; biraz bekleyip tekrar dene'],
    [status === 400, 'bad_request', 'İstek reddedildi'],
    [status >= 500, 'server', `${PROVIDER_LABEL} sunucu hatası; daha sonra tekrar dene`],
  ];
  const [, kind, msg] = map.find(([cond]) => cond) ?? [true, 'bad_request' as LlmErrorKind, 'Beklenmeyen yanıt'];
  return new LlmError(kind, `${msg} [HTTP ${status}]${d}`);
}

/**
 * Yanıtı .md sonucuna çevirir. Çıktı sınırında kesilen (status "incomplete"), yarım JSON ya da boş
 * yanıt SESSİZCE KABUL EDİLMEZ: truncated işaretlenir, kurtarılabilen kısım gösterilir.
 */
export function interpretMarkdown(text: string, status: string): MarkdownResult {
  let parsed: { markdown?: unknown; briefing?: unknown } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const md = typeof parsed?.markdown === 'string' ? parsed.markdown : salvageString(text, 'markdown');
  const briefing = typeof parsed?.briefing === 'string' ? parsed.briefing : salvageString(text, 'briefing');
  if (status === 'incomplete') {
    return { markdown: md, briefing, truncated: true, note: 'Yanıt modelin çıktı sınırında kesildi; .md eksik. PDF\'i daha küçük konulara bölüp tekrar dene.' };
  }
  if (!parsed) return { markdown: md, briefing, truncated: true, note: 'Yanıt yarım ya da bozuk geldi; .md eksik olabilir. Yeniden üretmeyi dene.' };
  if (!md.trim()) return { markdown: '', briefing, truncated: true, note: 'Model boş bir .md döndürdü.' };
  return { markdown: md, briefing, truncated: false };
}

/** Yarım JSON'dan bir dize alanının okunabilen kısmını çıkarır (kesilmiş yanıtı göstermek için). */
function salvageString(raw: string, field: string): string {
  const m = raw.match(new RegExp(`"${field}"\\s*:\\s*"`));
  if (!m || m.index === undefined) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') break; // dizenin sonu
    if (c !== '\\') {
      out += c;
      continue;
    }
    const seq = raw.slice(i, i + (raw[i + 1] === 'u' ? 6 : 2));
    try {
      out += JSON.parse(`"${seq}"`) as string;
    } catch {
      break; // yarım kalmış kaçış dizisi: kesildiği yer
    }
    i += seq.length - 1;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
