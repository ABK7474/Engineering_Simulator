// Sağlayıcıdan bağımsız LLM arayüzü. Oyunun geri kalanı yalnız buradaki soyut fonksiyonları
// çağırır; hangi sağlayıcının kullanıldığını bilmez. Sağlayıcıya özgü her şey client.ts'te.
// LLM yalnız "konu ekle" akışında çağrılır; oyun sırasında hiç çağrılmaz.

import { createProvider, DEFAULT_MODEL, KEY_ADVICE, PROVIDER_LABEL } from './client';
import { createMockProvider } from './mock';

export type TemplateType = 'series-led' | 'series-parallel';

export interface MarkdownResult {
  markdown: string;
  /** Konu kartı için kısa brifing özeti. */
  briefing: string;
  /** Yanıt çıktı sınırında kesildi ya da eksik/bozuk geldi: kullanıcı onaylayamaz. */
  truncated: boolean;
  /** Kesilme ya da eksiklik nedeni (kullanıcıya gösterilir). */
  note?: string;
}

export interface TemplateRequest {
  type: TemplateType;
  markdown: string;
  courseName: string;
  topicName: string;
  count: number;
}

export interface TemplateResult {
  /** LLM'in ham önerisi; DOĞRULANMAMIŞTIR (solvers/templates.ts doğrular). */
  candidates: unknown;
  truncated: boolean;
}

export type LlmErrorKind = 'no_key' | 'invalid_key' | 'model_unavailable' | 'quota' | 'bad_request' | 'server' | 'network' | 'bad_response';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface ConnectionCheck {
  ok: boolean;
  kind: 'ok' | LlmErrorKind;
  message: string;
}

export interface LlmProvider {
  /** Arayüzde gösterilecek sağlayıcı adı. */
  readonly label: string;
  readonly model: string;
  pdfToMarkdown: (pdf: Uint8Array, ctx: { courseName: string; topicName: string }) => Promise<MarkdownResult>;
  generateTemplates: (req: TemplateRequest) => Promise<TemplateResult>;
  testConnection: () => Promise<ConnectionCheck>;
}

export interface LlmSettings {
  apiKey: string | null;
  model: string;
  /** Sahte istemci (testler ve `?llm=mock`). */
  mock: boolean;
}

export const LLM_DEFAULTS = { label: PROVIDER_LABEL, model: DEFAULT_MODEL, keyAdvice: KEY_ADVICE };

export function getProvider(s: LlmSettings): LlmProvider {
  if (s.mock) return createMockProvider();
  if (!s.apiKey) throw new LlmError('no_key', 'API anahtarı yok. ⋯ → Ayarlar\'dan ekleyebilirsin.');
  return createProvider({ apiKey: s.apiKey, model: s.model || DEFAULT_MODEL });
}

export function pdfToMarkdown(s: LlmSettings, pdf: Uint8Array, ctx: { courseName: string; topicName: string }): Promise<MarkdownResult> {
  return getProvider(s).pdfToMarkdown(pdf, ctx);
}

export function generateTemplates(s: LlmSettings, req: TemplateRequest): Promise<TemplateResult> {
  return getProvider(s).generateTemplates(req);
}
