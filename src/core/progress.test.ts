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
  p.faults = { 'door-lock': { stagesDone: 1 } };
  p.world = { room: 'lab-c1', discovered: ['corridor-b2', 'lab-c1'], states: ['door.b2c1.unlocked'], seenLines: ['start'], scorched: ['door-lock'] };
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
    ['bozuk dünya alanı', { ...sample(), world: { room: 'x', discovered: 'hepsi' } }],
  ])('bozuk veriyi reddeder: %s', (_n, raw) => {
    expect(validateProgress(raw, B)).toBeNull();
  });
});

// Eski sürümlerin göçü: v1 (tek aşamalı kapı) → v2 (aşamalı) → v3 (dünya)
const CTX = {
  startRoom: 'corridor-b2',
  faults: [
    { id: 'door-lock', card: 'door-power-01', provides: ['door.b2c1.unlocked'], stageCount: 2 },
    { id: 'backup-power', card: 'backup-power-01', provides: ['power.backup'], stageCount: 1 },
  ],
};
const legacy = (version: 1 | 2, faults: Record<string, unknown>, scorch = false) => {
  const p = JSON.parse(JSON.stringify(sample()));
  delete p.world;
  p.version = version;
  p.faults = faults;
  p.scars = { panelScorch: scorch };
  p.resources.damages = p.resources.damages.map((d: { faultId: string }) => ({ ...d, faultId: version === 1 ? 'door-power-01' : 'door-power-01#1' }));
  return p;
};

describe('v2 → v3 göçü (tek koridordan dünyaya)', () => {
  it('kart kimliği dünya arıza kimliğine çevrilir; bitmiş arızanın durumu eklenir', () => {
    const m = validateProgress(legacy(2, { 'door-power-01': { stagesDone: 2 } }, true), B, CTX)!;
    expect(m.version).toBe(3);
    expect(m.faults).toEqual({ 'door-lock': { stagesDone: 2 } });
    expect(m.world).toEqual({ room: 'corridor-b2', discovered: ['corridor-b2'], states: ['door.b2c1.unlocked'], seenLines: [], scorched: ['door-lock'] });
    expect(m.resources.damages.every((d) => d.faultId === 'door-lock#1')).toBe(true);
  });

  it('yarım kalmış arıza durum sağlamaz', () => {
    const m = validateProgress(legacy(2, { 'door-power-01': { stagesDone: 1 } }), B, CTX)!;
    expect(m.world.states).toEqual([]);
    expect(m.world.scorched).toEqual([]);
  });

  it('v1 → v2 → v3 zinciri: v1\'de onarılmış = yalnız 1. aşama tamam (kapı açık sayılmaz)', () => {
    const m = validateProgress(legacy(1, { 'door-power-01': { repaired: true } }), B, CTX)!;
    expect(m.faults).toEqual({ 'door-lock': { stagesDone: 1 } });
    expect(m.world.states).toEqual([]);
    expect(m.resources.damages.every((d) => d.faultId === stageKey('door-lock', 0))).toBe(true);
  });

  it('göç bilgisi olmadan eski kayıt reddedilir; bozuk v1 de', () => {
    expect(validateProgress(legacy(2, { 'door-power-01': { stagesDone: 2 } }), B)).toBeNull();
    expect(validateProgress(legacy(1, { 'door-power-01': { repaired: 'evet' } }), B, CTX)).toBeNull();
  });

  it('varsayılan ilerleme başlangıç odasını keşfedilmiş sayar', () => {
    expect(defaultProgress(B, 'corridor-b2').world).toEqual({ room: 'corridor-b2', discovered: ['corridor-b2'], states: [], seenLines: [], scorched: [] });
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

describe('ad, prolog ve final seçimi', () => {
  it('yeni oyunda ad Deniz, prolog oynanmamış, seçim yok', () => {
    const p = defaultProgress(B, 'corridor-b2');
    expect(p.profile.name).toBe('Deniz');
    expect(p.prologueDone).toBe(false);
    expect(p.ending).toBeNull();
  });

  it('alanları olmayan eski kayıt: ad varsayılan; ilerlemesi varsa prolog görülmüş sayılır', () => {
    const base = defaultProgress(B, 'corridor-b2') as unknown as Record<string, unknown>;
    const { profile: _p, prologueDone: _d, ending: _e, ...old } = base;
    expect(validateProgress(old, B)!.prologueDone).toBe(false);
    const played = { ...old, world: { ...(old.world as object), states: ['power.backup'] } };
    const v = validateProgress(played, B)!;
    expect(v.prologueDone).toBe(true);
    expect(v.profile.name).toBe('Deniz');
    expect(v.ending).toBeNull();
  });

  it('ad sadeleşir; geçersiz seçim yok sayılır; yedekte korunur', () => {
    const p = { ...defaultProgress(B, 'corridor-b2'), profile: { name: '  Ayşe   Nur ' }, prologueDone: true, ending: 'stayed' as const };
    const v = validateProgress(structuredClone(p), B)!;
    expect(v.profile.name).toBe('Ayşe Nur');
    expect(v.ending).toBe('stayed');
    expect(validateProgress({ ...p, ending: 'kaçtı' }, B)!.ending).toBeNull();
    expect(fromExportJson(toExportJson(v), B).profile.name).toBe('Ayşe Nur');
  });
});
