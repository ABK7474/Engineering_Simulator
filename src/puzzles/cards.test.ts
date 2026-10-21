import { describe, expect, it } from 'vitest';
import type { FaultCard } from '../core/types';
import { prepareStage, validateStage } from './stages';

const cards = import.meta.glob<FaultCard>('../../content/faults/*.json', { eager: true, import: 'default' });

describe('içerik: bütün arıza kartları', () => {
  it.each(Object.entries(cards))('%s geçerli; her aşama 5 tohumda üretilir', (_path, card) => {
    expect(card.stages.length).toBeGreaterThan(0);
    for (const s of card.stages) {
      validateStage(s);
      for (let seed = 1; seed <= 5; seed++) {
        const run = prepareStage(s, seed);
        // İpucu: yöntem + (çoğu türde) ara değer; boş ipucu yok
        expect(run.hints.length, `${s.id} ipucu`).toBeGreaterThanOrEqual(1);
        for (const h of run.hints) expect(h.trim().length).toBeGreaterThan(10);
      }
    }
  });
});
