// Baştan sona oynanış (düğümde): her adımda yalnız o an açık kapılardan yürüyerek, çözülebilir arızaların
// terminallerine ulaşılabilmeli; zincir tıkanmadan bütün arızalar onarılmalı ve tehdit olayı bitmeli.
import { describe, expect, it } from 'vitest';
import { loadWorld } from './content';
import { doorOpen, missingFor, withProvided } from './state';
import { unreachable, walkTargets } from './walk';

describe('baştan sona oynanış', () => {
  it('kilitli kapı, ulaşılamayan arıza ya da bitmeyen zincir yok', () => {
    const { world: W, layout: L } = loadWorld(undefined, undefined, undefined, { verifySeeds: 0 });
    const targetOf = (fid: string) => walkTargets(L).find((t) => t.label === `terminal '${fid}'`)!;
    let states = [...W.initialStates];
    const solved = new Set<string>();
    const order: string[] = [];
    for (let step = 0; step < 50 && solved.size < W.faults.length; step++) {
      // Tehdit olayı: koşulları sağlanınca başlar (oyunda 25 sn dolaşma sonra)
      for (const t of W.threats) if (t.after.every((s) => states.includes(s)) && !states.includes(t.clearedBy) && !states.includes(t.activeState)) states = [...states, t.activeState];
      const ready = W.faults.filter((f) => !solved.has(f.id) && !missingFor(f, states).length && (!f.event || states.includes(W.threats.find((t) => t.id === f.event)!.activeState)));
      expect(ready.length, `adım ${step}: çözülebilir arıza yok; çözülenler: ${order.join(' → ')}`).toBeGreaterThan(0);
      const closed = new Set(W.doors.filter((d) => !doorOpen(d, states)).map((d) => d.id));
      const stuck = unreachable(L, { closedDoors: closed, targets: ready.map((f) => targetOf(f.id)) });
      expect(stuck.map((t) => t.label), `adım ${step}: kapalı kapılar ${[...closed].join(', ')}`).toEqual([]);
      for (const f of ready) {
        solved.add(f.id);
        order.push(f.id);
        states = withProvided(states, f);
      }
      for (const t of W.threats) if (states.includes(t.clearedBy)) states = states.filter((s) => s !== t.activeState);
    }
    expect(solved.size).toBe(W.faults.length);
    expect(W.doors.every((d) => doorOpen(d, states)), 'sonunda bütün kapılar açık').toBe(true);
    // Sıra (rapor için): kapalı kapıyla gerçekten engelleniyor mu — kontrol: başta P-1 kapalı, terminali erişilemez
    const closedAtStart = new Set(W.doors.filter((d) => !doorOpen(d, W.initialStates)).map((d) => d.id));
    expect(unreachable(L, { closedDoors: closedAtStart, targets: [targetOf('generator-sync')] })).toHaveLength(1);
    console.log('oynanış sırası:', order.join(' → '));
  });
});

describe('yerleşim belirlenimciliği', () => {
  it('rastgele karşılaştırıcıyla sıralama yok (sonuç JS motoruna bağlı; tarayıcı ile düğüm farklı yerleşim üretirdi)', () => {
    const files = import.meta.glob<string>('../**/*.ts', { eager: true, query: '?raw', import: 'default' });
    const bad = Object.entries(files).filter(([p, src]) => !p.endsWith('.test.ts') && /\.sort\(\s*\(\)\s*=>/.test(src)).map(([p]) => p);
    expect(bad).toEqual([]);
  });
});
