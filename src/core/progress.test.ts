import { describe, expect, it, vi } from 'vitest';
import balanceJson from '../../content/balance/resources.json';
import {
  defaultProgress,
  fromExportJson,
  loadProgress,
  MemoryStore,
  stageKey,
  toExportJson,
  validateProgress,
  type ProgressData,
} from './progress';
import { applyOutcome, parseBalance } from './resources';

const B = parseBalance(balanceJson);

function sample(): ProgressData {
  const p = defaultProgress(B);
  p.resources = applyOutcome(p.resources, B, 'door-power-01', {
    kind: 'led_burnt',
    severity: 2,
    resistorOverheat: true,
    headline: '',
    explanation: '',
  }).state;
  p.episode = 3;
  p.attemptsThisEpisode = 2;
  p.worstEvent = { label: 'LED yandı', total: 20 };
  p.faults = { 'door-power-01': { stagesDone: 1 } };
  p.scars.panelScorch = true;
  p.savedAt = '2026-10-20T12:00:00.000Z';
  return p;
}

describe('validateProgress', () => {
  it('geçerli veriyi aynen döndürür (JSON gidiş-dönüş)', () => {
    const p = sample();
    expect(validateProgress(JSON.parse(JSON.stringify(p)), B)).toEqual(p);
  });

  it('varsayılan ilerleme geçerli', () => {
    expect(validateProgress(defaultProgress(B), B)).toEqual(defaultProgress(B));
  });

  it.each([
    ['null', null],
    ['eski sürüm', { ...sample(), version: 0 }],
    ['eksik kaynak', { ...sample(), resources: { ...sample().resources, values: { oxygen: 50 } } }],
    ['aralık dışı değer', { ...sample(), resources: { ...sample().resources, values: { oxygen: 150, power: 50 } } }],
    ['NaN değer', { ...sample(), resources: { ...sample().resources, values: { oxygen: Number.NaN, power: 50 } } }],
    ['bilinmeyen kaynakta tüketim', { ...sample(), resources: { ...sample().resources, damages: [{ faultId: 'x', source: 'dim', label: 'x', drainPerMinute: { water: 1 } }] } }],
    ['bölüm 0', { ...sample(), episode: 0 }],
    ['bozuk iz', { ...sample(), scars: {} }],
  ])('bozuk veriyi reddeder: %s', (_n, raw) => {
    expect(validateProgress(raw, B)).toBeNull();
  });
});

describe('v1 → v2 göçü', () => {
  const v1 = () => {
    const p = JSON.parse(JSON.stringify(sample()));
    p.version = 1;
    p.faults = { 'door-power-01': { repaired: true }, 'baska': { repaired: false } };
    p.resources.damages = p.resources.damages.map((d: { faultId: string }) => ({ ...d, faultId: 'door-power-01' }));
    return p;
  };

  it('onarılmış arıza yalnız 1. aşaması bitmiş sayılır (v1\'de tek aşama vardı); onarılmamış 0', () => {
    // Hata: önce "tüm aşamalar bitti" sayılıyordu; eski kaydı olan oyuncuda kapı aşama 2 oynanmadan açık başlıyordu.
    const m = validateProgress(v1(), B)!;
    expect(m.version).toBe(2);
    expect(m.faults).toEqual({ 'door-power-01': { stagesDone: 1 }, baska: { stagesDone: 0 } });
  });

  it('kalıcı hasar anahtarı arıza#0 olur (v1\'de tek aşama vardı)', () => {
    const m = validateProgress(v1(), B)!;
    expect(m.resources.damages.every((d) => d.faultId === stageKey('door-power-01', 0))).toBe(true);
    expect(m.resources.values).toEqual(sample().resources.values);
  });

  it('bozuk v1 kaydı reddedilir', () => {
    expect(validateProgress({ ...v1(), faults: { 'door-power-01': { repaired: 'evet' } } }, B)).toBeNull();
  });
});

describe('dışa/içe aktarma', () => {
  it('dışa aktarılan yedek aynen geri okunur', () => {
    const p = sample();
    expect(fromExportJson(toExportJson(p), B)).toEqual(p);
  });

  it('yabancı ya da bozuk dosyayı açıklamalı reddeder', () => {
    expect(() => fromExportJson('{bozuk', B)).toThrow(/JSON/);
    expect(() => fromExportJson('{"format":"baska"}', B)).toThrow(/yedeği değil/);
    expect(() => fromExportJson(JSON.stringify({ format: 'derin-muhendis/progress', progress: { version: 1 } }), B)).toThrow(/bozuk/);
  });
});

describe('loadProgress', () => {
  it('boş depoda varsayılan', async () => {
    expect(await loadProgress(new MemoryStore(), B)).toEqual(defaultProgress(B));
  });

  it('kaydedileni geri yükler', async () => {
    const store = new MemoryStore();
    await store.save(sample());
    expect(await loadProgress(store, B)).toEqual(sample());
  });

  it('bozuk kayıtta uyarıp varsayılana döner', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new MemoryStore();
    await store.save({ ...sample(), episode: -1 });
    expect(await loadProgress(store, B)).toEqual(defaultProgress(B));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('bellek deposu kopya tutar (dışarıdan değişiklik kayda sızmaz)', async () => {
    const store = new MemoryStore();
    const p = sample();
    await store.save(p);
    p.episode = 99;
    expect((await loadProgress(store, B)).episode).toBe(3);
  });
});
