import { describe, expect, it } from 'vitest';
import coursesJson from '../../content/courses.json';
import logsJson from '../../content/story/logs.json';
import topicsJson from '../../content/topics.json';
import worldJson from '../../content/world/season1-world.json';
import { formulaPages, parseLogs, unlockedLogs } from './notebook';
import { recordReview } from './review';
import type { FaultCard } from './types';

const cards = Object.values(import.meta.glob<FaultCard>('../../content/faults/*.json', { eager: true, import: 'default' }));
const LOGS = parseLogs(logsJson);

describe('defter', () => {
  it('her kayıt dünyada sağlanabilen durumlarla açılır', () => {
    // prologue.done: prolog bitince (ya da atlanınca) eklenir
    const states = new Set([...worldJson.faults.flatMap((f) => f.provides), ...worldJson.threats.map((t) => t.activeState), 'prologue.done']);
    for (const l of LOGS) for (const s of l.after) expect(states.has(s), `${l.id}: ${s}`).toBe(true);
  });

  it('kayıtlar durumlara göre açılır', () => {
    expect(unlockedLogs(LOGS, [])).toEqual([]);
    expect(unlockedLogs(LOGS, ['power.backup']).map((l) => l.id)).toEqual(['log-01']);
  });

  it('içerikteki her konu etiketinin Türkçe adı var', () => {
    const names = topicsJson as Record<string, string>;
    for (const c of cards) for (const s of c.stages) expect(names[s.topic], `${c.id}/${s.id}: ${s.topic}`).toBeTruthy();
  });

  it('formül sayfaları yalnız denenmiş konular; aynı konudaki iki aşama tek sayfada', () => {
    const courseNames = Object.fromEntries(coursesJson.map((c) => [c.id, c.name]));
    let review = recordReview({}, 'olasilik-istatistik/bayes-teoremi', true, 0);
    review = recordReview(review, 'devre-teorisi-1/superpozisyon', false, 0);
    const pages = formulaPages(cards, review, courseNames, topicsJson as Record<string, string>);
    expect(pages.map((p) => p.topicName)).toEqual(['Süperpozisyon', 'Bayes teoremi']);
    expect(pages[1].notes.length).toBe(2); // kaçak teşhisi + sonar teması
    expect(pages[1].box).toBe(1);
  });

  it('bozuk kayıt dosyası açıklamalı hata verir', () => {
    expect(() => parseLogs({})).toThrow(/logs dizisi/);
    expect(() => parseLogs({ logs: [{ id: 'a', title: 't', text: 'x', after: [] }] })).toThrow(/after/);
  });
});
