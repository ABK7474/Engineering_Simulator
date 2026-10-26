// İçerik hattı orkestrasyonu: PDF → (LLM) → taslak .md → [kullanıcı onayı] → (LLM) şablon
// adayları → çözücü/doğrulayıcı → kütüphane. Arayüzden bağımsız; sahte istemciyle uçtan uca test edilir.

import { assertCanGenerate, withTemplates, type TemplateReport, type Topic } from '../core/library';
import type { StageDef } from '../core/types';
import { generateTemplates, pdfToMarkdown, type LlmSettings, type TemplateType } from '../llm/llm';
import { validateCandidates } from '../solvers/templates';

export interface Course {
  id: string;
  name: string;
  problemTypes: TemplateType[];
}

export const TYPE_LABEL: Record<TemplateType, string> = {
  'series-led': 'Seri LED devresi',
  'series-parallel': 'Seri-paralel direnç devresi',
};

/** LLM'e tür başına istenen aday sayısı. */
export const CANDIDATES_PER_TYPE = 5;

export interface DraftInput {
  course: Course;
  name: string;
  fileName: string;
  pdf: Uint8Array;
  pages: number | null;
  /** Klasörden gelen dosya: içerik özeti ve ders_materyalleri/'ne göre yolu. */
  folder?: { sha256: string; path: string };
}

export async function createTopicDraft(settings: LlmSettings, input: DraftInput, now = new Date()): Promise<Topic> {
  const r = await pdfToMarkdown(settings, input.pdf, { courseName: input.course.name, topicName: input.name });
  return {
    // Klasördeki dosyanın kimliği içerikten: aynı dosya aynı kimlik; değişen dosya yeni taslak
    id: input.folder ? `${input.course.id}-f-${input.folder.sha256.slice(0, 12)}` : `${input.course.id}-${now.getTime().toString(36)}`,
    courseId: input.course.id,
    courseName: input.course.name,
    name: input.name,
    status: 'draft',
    markdown: r.markdown,
    briefing: r.briefing,
    formulaSheet: r.formulas,
    truncated: r.truncated,
    note: r.note ?? null,
    source: { fileName: input.fileName, bytes: input.pdf.byteLength, pages: input.pages, ...(input.folder ?? {}) },
    origin: input.folder ? 'folder' : 'upload',
    model: settings.mock ? 'mock' : settings.model,
    createdAt: now.toISOString(),
    approvedAt: null,
    templates: [],
    report: null,
  };
}

/**
 * Onaylı konudan dersin desteklediği her problem türü için şablon üretir ve doğrular.
 * Onaysız konuda hata verir. Doğrulanamayan adaylar elenir ve raporlanır.
 */
export async function generateTopicTemplates(
  settings: LlmSettings,
  topic: Topic,
  ctx: { course: Course; bases: Record<TemplateType, StageDef>; existing: StageDef[]; seeds?: number },
): Promise<Topic> {
  assertCanGenerate(topic);
  const report: TemplateReport = { total: 0, accepted: 0, rejected: [], truncatedTypes: [] };
  const accepted: StageDef[] = [];
  for (const type of ctx.course.problemTypes) {
    const res = await generateTemplates(settings, {
      type,
      markdown: topic.markdown,
      courseName: topic.courseName,
      topicName: topic.name,
      count: CANDIDATES_PER_TYPE,
    });
    if (res.truncated) {
      report.truncatedTypes.push(type);
      continue;
    }
    const run = validateCandidates(type, res.candidates, {
      base: ctx.bases[type],
      topic: { id: topic.id, courseId: topic.courseId, name: topic.name, courseName: topic.courseName, briefing: topic.briefing },
      existing: [...ctx.existing, ...accepted],
      seeds: ctx.seeds,
    });
    report.total += run.total;
    report.accepted += run.accepted.length;
    report.rejected.push(...run.rejected.map((r) => ({ type, ...r })));
    accepted.push(...run.accepted);
  }
  return withTemplates(topic, accepted, report);
}
