import { describe, expect, it } from 'vitest';
import { menuItems, newGameNeedsConfirm } from './main-menu';

describe('ana menü seçenekleri', () => {
  it('kayıt yoksa "Devam et" yok, yeni oyun onaysız', () => {
    expect(menuItems(false)).toEqual(['new', 'settings', 'controls', 'library']);
    expect(newGameNeedsConfirm(false)).toBe(false);
  });

  it('kayıt varsa "Devam et" ilk sırada, yeni oyun kayıt silineceği için onay ister', () => {
    expect(menuItems(true)[0]).toBe('continue');
    expect(menuItems(true)).toHaveLength(5);
    expect(newGameNeedsConfirm(true)).toBe(true);
  });
});
