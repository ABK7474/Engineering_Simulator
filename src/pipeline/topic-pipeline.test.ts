// Hattın tamamı sahte istemciyle: PDF → taslak → onay → şablon → doğrulama → havuz.

import { describe, expect, it } from 'vitest';
import courses from '../../content/courses.json';
import fault from '../../content/faults/door-power-01.json';
import { approveTopic, emptyLibrary, templatePool, upsertTopic } from '../core/library';
import type { StageDef } from '../core/types';
import { MOCK_EXPECTED } from '../llm/mock';
import { prepareStage, validateStage } from '../puzzles/stages';
import { createTopicDraft, generateTopicTemplates, type Course } from './topic-pipeline';

const MOCK = { apiKey: null, model: 'x', mock: true };
const bases = { 'series-led': fault.stages[0] as StageDef, 'series-parallel': fault.stages[1] as StageDef };
const devre = (courses as Course[]).find((c) => c.id === 'devre-teorisi-1')!;
const diffEq = (courses as Course[]).find((c) => c.id === 'diferansiyel-denklemler')!;
const pdf = new TextEncoder().encode('%PDF-1.7 sahte');

describe('içerik hattı (sahte istemci)', () => {
  it('taslak → onay → şablon → doğrulama → oyun havuzu', async () => {
    const draft = await createTopicDraft(MOCK, { course: devre, name: 'Seri devreler', fileName: 'not.pdf', pdf, pages: 3 });
    expect(draft).toMatchObject({ status: 'draft', truncated: false, courseName: 'Devre Teorisi 1', model: 'mock' });
    expect(draft.markdown).toContain('```devre');

    await expect(generateTopicTemplates(MOCK, draft, { course: devre, bases, existing: [], seeds: 5 })).rejects.toThrow(/onaylanmadan/);

    const approved = approveTopic(draft, { markdown: draft.markdown + '\nKullanıcı notu.', briefing: draft.briefing });
    const done = await generateTopicTemplates(MOCK, approved, { course: devre, bases, existing: [], seeds: 5 });
    const total = MOCK_EXPECTED['series-led'].total + MOCK_EXPECTED['series-parallel'].total;
    const acc = MOCK_EXPECTED['series-led'].accepted + MOCK_EXPECTED['series-parallel'].accepted;
    expect(done.report).toMatchObject({ total, accepted: acc, truncatedTypes: [] });
    expect(done.report!.rejected).toHaveLength(total - acc);
    expect(done.templates).toHaveLength(acc);

    // Oyunda: havuzdan çıkar, aşama hazırlanır, panel brifingi konunun özetini taşır
    const lib = upsertTopic(emptyLibrary(), done);
    const led = templatePool(lib, 'series-led');
    expect(led).toHaveLength(MOCK_EXPECTED['series-led'].accepted);
    for (const def of [...led, ...templatePool(lib, 'series-parallel')]) {
      expect(() => validateStage(def)).not.toThrow();
      expect(() => prepareStage(def, 77)).not.toThrow();
      expect(def.briefing).toContain(approved.briefing);
    }
  });

  it('kesilmiş .md taslak olarak gelir ve onaylanamaz', async () => {
    const draft = await createTopicDraft(MOCK, { course: devre, name: 'Kesik konu', fileName: 'uzun.pdf', pdf, pages: 90 });
    expect(draft.truncated).toBe(true);
    expect(draft.note).toMatch(/kesildi/);
    expect(() => approveTopic(draft, { markdown: draft.markdown, briefing: draft.briefing })).toThrow(/Eksik/);
  });

  it('problem türü olmayan derste .md + brifing saklanır, şablon üretilmez', async () => {
    const draft = await createTopicDraft(MOCK, { course: diffEq, name: 'Birinci mertebe', fileName: 'de.pdf', pdf, pages: 2 });
    const done = await generateTopicTemplates(MOCK, approveTopic(draft, { markdown: '# x', briefing: 'y' }), {
      course: diffEq,
      bases,
      existing: [],
    });
    expect(done.templates).toEqual([]);
    expect(done.report).toMatchObject({ total: 0, accepted: 0 });
  });
});
