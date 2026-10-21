// Defter içeriği (saf): durumlarla açılan istasyon kayıtları ve karşılaşılan konuların formül özetleri.
// Formül özeti, o konudaki aşamaların brifingleridir (içerik JSON'da; kod yazmadan genişler).

import type { FaultCard } from './types';
import type { ReviewState } from './review';

export interface StationLog {
  id: string;
  title: string;
  /** Kayıt bu durumların hepsi sağlanınca açılır. */
  after: string[];
  text: string;
}

export function parseLogs(raw: unknown): StationLog[] {
  const logs = (raw as { logs?: unknown })?.logs;
  if (!Array.isArray(logs)) throw new Error('logs.json: logs dizisi yok');
  const ids = new Set<string>();
  for (const l of logs as StationLog[]) {
    if (typeof l?.id !== 'string' || ids.has(l.id)) throw new Error(`logs.json: kimlik eksik ya da yinelenmiş (${l?.id})`);
    ids.add(l.id);
    if (typeof l.title !== 'string' || typeof l.text !== 'string' || !l.text.trim()) throw new Error(`logs.json '${l.id}': başlık/metin eksik`);
    if (!Array.isArray(l.after) || !l.after.length || !l.after.every((s) => typeof s === 'string')) throw new Error(`logs.json '${l.id}': after durum listesi olmalı`);
  }
  return logs as StationLog[];
}

export const unlockedLogs = (logs: readonly StationLog[], states: readonly string[]) => logs.filter((l) => l.after.every((s) => states.includes(s)));

export interface FormulaPage {
  course: string;
  courseName: string;
  topic: string;
  topicName: string;
  /** Konudaki farklı aşama brifingleri (başlığıyla). */
  notes: { title: string; text: string }[];
  box: number;
}

/** Tekrar kaydında görülen (en az bir kez denenmiş) konuların sayfaları; ders ve konu adına göre sıralı. */
export function formulaPages(cards: readonly FaultCard[], review: ReviewState, courseNames: Record<string, string>, topicNames: Record<string, string>): FormulaPage[] {
  const pages = new Map<string, FormulaPage>();
  for (const card of cards)
    for (const s of card.stages) {
      const key = `${s.course}/${s.topic}`;
      if (!review[key]) continue;
      const page = pages.get(key) ?? { course: s.course, courseName: courseNames[s.course] ?? s.course, topic: s.topic, topicName: topicNames[s.topic] ?? s.title, notes: [], box: review[key].box };
      if (!page.notes.some((n) => n.text === s.briefing)) page.notes.push({ title: s.title, text: s.briefing });
      pages.set(key, page);
    }
  return [...pages.values()].sort((a, b) => a.courseName.localeCompare(b.courseName, 'tr') || a.topicName.localeCompare(b.topicName, 'tr'));
}
