import { describe, expect, it } from 'vitest';
import { Tweens } from './effects';

describe('Tweens', () => {
  it('bir animasyonun içinde eklenen animasyon kaybolmaz ve sonraki karede başlar', () => {
    const tw = new Tweens();
    const log: string[] = [];
    tw.add((_dt, el) => {
      if (el < 0.2) return true;
      log.push('açıldı');
      tw.add((_d, el2) => {
        log.push(`kapanıyor ${el2.toFixed(1)}`);
        return el2 < 0.2;
      });
      return false;
    });
    for (let i = 0; i < 6; i++) tw.update(0.1);
    expect(log).toEqual(['açıldı', 'kapanıyor 0.1', 'kapanıyor 0.2']);
  });

  it('temizleme bekleyenleri siler', () => {
    const tw = new Tweens();
    let n = 0;
    tw.add(() => (n++, true));
    tw.update(0.1);
    tw.clear();
    tw.update(0.1);
    expect(n).toBe(1);
  });
});
