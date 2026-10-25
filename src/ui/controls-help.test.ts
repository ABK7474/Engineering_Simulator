import { describe, expect, it } from 'vitest';
import { CONTROLS } from './controls-help';

describe('kontroller listesi', () => {
  it('her tek harfli tuş bir işe atanmış; aynı tuş iki kez yok', () => {
    const singles = CONTROLS.map(([k]) => k).filter((k) => /^[A-Z]$/.test(k));
    expect(new Set(singles).size).toBe(singles.length);
    expect(singles.sort()).toEqual(['C', 'E', 'K', 'M', 'N', 'Q']);
  });
});
