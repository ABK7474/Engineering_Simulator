// Sağlayıcıdan bağımsız LLM arayüzü. Oyunun geri kalanı yalnız buradaki soyut fonksiyonları
// çağırır; hangi sağlayıcının kullanıldığını bilmez. Sağlayıcıya özgü her şey client.ts'te.
// LLM yalnız "konu ekle" akışında çağrılır; oyun sırasında hiç çağrılmaz.

import { createProvider, DEFAULT_MODEL, FALLBACK_MODEL, KEY_ADVICE, PROVIDER_LABEL } from './client';
import { createMockProvider } from './mock';

export type TemplateType = 'series-led' | 'series-parallel';

export interface MarkdownResult {
  markdown: string;
  /** Konu kartı için kısa brifing özeti. */
  briefing: string;
  /** Formül sayfası taslağı (Markdown; defterde konu sayfası olur). */
  formulas: string;
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

export type LlmErrorKind = 'no_key' | 'invalid_key' | 'model_unavailable' | 'quota' | 'bad_request' | 'server' | 'network' | 'timeout' | 'bad_response';

/** Soru analizi için tek dosya (PDF ya da görsel). */
export interface QuestionFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface QuestionAnalysisResult {
  /** LLM'in ham analizi; DOĞRULANMAMIŞTIR (core/analysis.ts doğrular). */
  analysis: unknown;
  truncated: boolean;
}

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    /** Bu hatada denenebilecek model (ör. kota ya da erişilemeyen modelde daha hafif olanı); yoksa null. */
    readonly suggestModel: string | null = null,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface ConnectionCheck {
  ok: boolean;
  kind: 'ok' | LlmErrorKind;
  message: string;
  /** Ayarlar'da tek tıkla geçilebilecek model (kota ya da erişilemeyen model); yoksa null. */
  suggestModel: string | null;
}

export interface LlmProvider {
  /** Arayüzde gösterilecek sağlayıcı adı. */
  readonly label: string;
  readonly model: string;
  pdfToMarkdown: (pdf: Uint8Array, ctx: { courseName: string; topicName: string }) => Promise<MarkdownResult>;
  generateTemplates: (req: TemplateRequest) => Promise<TemplateResult>;
  /** Bir soru dosyasındaki kalıplar (dosya başına; ders düzeyinde birleştirme kodda). */
  analyzeQuestions: (file: QuestionFile, ctx: { courseName: string; catalog: string }) => Promise<QuestionAnalysisResult>;
  testConnection: () => Promise<ConnectionCheck>;
}

export interface LlmSettings {
  apiKey: string | null;
  model: string;
  /** Sahte istemci (testler ve `?llm=mock`). */
  mock: boolean;
}

export const LLM_DEFAULTS = { label: PROVIDER_LABEL, model: DEFAULT_MODEL, fallbackModel: FALLBACK_MODEL, keyAdvice: KEY_ADVICE };

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

export function analyzeQuestions(s: LlmSettings, file: QuestionFile, ctx: { courseName: string; catalog: string }): Promise<QuestionAnalysisResult> {
  return getProvider(s).analyzeQuestions(file, ctx);
}
