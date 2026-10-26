import { describe, expect, it } from 'vitest';
import { digitOf, keySequence } from './key-sequence';

describe('gizli tuş dizisi', () => {
  it('yalnız tam dizi bitince tetiklenir; araya giren tuş sıfırlar', () => {
    const hit = keySequence('681');
    expect([...'68'].map(hit)).toEqual([false, false]);
    expect(hit('1')).toBe(true);
    expect([...'6821'].map(hit)).toEqual([false, false, false, false]);
    expect([...'66681'].map(hit).at(-1)).toBe(true);
  });
  it('tetiklendikten sonra yeniden baştan yazılmalı', () => {
    const hit = keySequence('681');
    expect([...'681'].map(hit).at(-1)).toBe(true);
    expect(hit('1')).toBe(false);
  });
  it('rakam tuşları: üst sıra ve sayısal takım', () => {
    expect(digitOf('Digit6')).toBe('6');
    expect(digitOf('Numpad8')).toBe('8');
    expect(digitOf('KeyE')).toBe('');
  });
});
