import { describe, expect, it } from 'vitest';
import { evaluate, namesIn } from './expr';

describe('evaluate', () => {
  it('öncelik, parantez, tekli eksi', () => {
    expect(evaluate('1 + 2 * 3', {})).toBe(7);
    expect(evaluate('(1 + 2) * 3', {})).toBe(9);
    expect(evaluate('-2 * -3', {})).toBe(6);
    expect(evaluate('10 / 4 / 5', {})).toBe(0.5);
    expect(evaluate('8 - 3 - 2', {})).toBe(3);
    expect(evaluate('1.5e3 + 0.5', {})).toBe(1500.5);
  });

  it('değişkenler: ölçümden motor direnci', () => {
    // 24 V, R_eski = 24 Ω, V_ölç = 12 V → Rm = 12·24/(24−12) = 24 Ω
    expect(evaluate('Vmeas*Rold/(Vs-Vmeas)', { Vmeas: 12, Rold: 24, Vs: 24 })).toBe(24);
  });

  it('hatalı ifadeleri açıklamalı reddeder', () => {
    expect(() => evaluate('a + ', { a: 1 })).toThrow(/beklenmeyen son/);
    expect(() => evaluate('(1 + 2', {})).toThrow(/'\)' eksik/);
    expect(() => evaluate('x * 2', {})).toThrow(/bilinmeyen ad 'x'/);
    expect(() => evaluate('2 3', {})).toThrow(/fazla/);
    expect(() => evaluate('alert(1)', { alert: 1 })).toThrow();
    expect(() => evaluate('a ^ 2', { a: 1 })).toThrow();
  });

  it('namesIn', () => {
    expect(namesIn('Va/(Is-Im) + Va')).toEqual(['Va', 'Is', 'Im']);
  });
});
