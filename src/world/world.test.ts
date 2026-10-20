// Dünya içeriği: doğrulayıcı (bozuk veride açıklayıcı hata, döngü), requires/provides, yerleşim.

import { describe, expect, it } from 'vitest';
import balanceJson from '../../content/balance/resources.json';
import storyJson from '../../content/story/season1.json';
import worldJson from '../../content/world/season1-world.json';
import { defaultProgress } from '../core/progress';
import { parseBalance } from '../core/resources';
import { CARDS, KNOWN_MODELS, loadWorld } from './content';
import { buildWorldLayout, CLEAR_PATH, insideAny, roomAt, WALL_DEPTH, WALL_INNER } from './layout';
import { respawnInRoom } from './respawn';
import { parseWorld, WorldError, type WorldDef } from './schema';
import { findCycle, missingFor, nextGoal, openDoors, reachableRooms, simulate, withProvided } from './state';
import { validateWorld, type Story } from './validate';

const W = parseWorld(worldJson);
const ctx = { cards: new Set(Object.keys(CARDS)), models: KNOWN_MODELS, story: storyJson as Story };
const clone = (): WorldDef => structuredClone(W);
const problems = (mut: (w: WorldDef) => void) => {
  const w = clone();
  mut(w);
  return validateWorld(w, ctx).join('\n');
};

describe('içerik yüklenir ve doğrulanır', () => {
  it('season1 dünyası geçerli; oda zorluğuyla bütün aşamalar 20 tohumda doğrulanır', () => {
    const c = loadWorld();
    expect(c.world.rooms.map((r) => r.id)).toEqual(['corridor-b2', 'lab-c1']);
    expect(c.stages['core-terminal'][0].config).toMatchObject({ binSize: 8 });
    expect(c.stages['core-terminal'][1].type).toBe('ds-trace');
    expect(c.stages['core-terminal'][1].config).toMatchObject({ ops: [10, 16], hideCounters: false });
  });
});

describe('yapısal hatalar açıklamalı', () => {
  it.each([
    ['kök nesne değil', null, /kök nesne/],
    ['oda tipi', { ...worldJson, rooms: [{ ...worldJson.rooms[0], type: 'mağara' }] }, /type 'corridor' ya da 'room'/],
    ['bilinmeyen duvar', { ...worldJson, rooms: [{ ...worldJson.rooms[0], walls: { tavan: {} } }] }, /bilinmeyen duvar 'tavan'/],
    ['bozuk anchor', { ...worldJson, faults: [{ ...worldJson.faults[0], anchor: { wall: 'east', index: 2, along: 3 } }] }, /anchor/],
    ['zorluk aralığı', { ...worldJson, rooms: [{ ...worldJson.rooms[0], difficulty: { tolerance: 0.5 } }] }, /tolerance 0,015–0,1/],
  ])('%s', (_n, raw, re) => {
    expect(() => parseWorld(raw)).toThrow(WorldError);
    expect(() => parseWorld(raw)).toThrow(re);
  });
});

describe('anlamsal hatalar açıklamalı', () => {
  it('yinelenen kimlik', () => expect(problems((w) => (w.faults[1].id = 'backup-power'))).toMatch(/'backup-power' birden fazla/));
  it('bilinmeyen kart ve model', () => {
    expect(problems((w) => (w.faults[0].card = 'yok-kart'))).toMatch(/bilinmeyen kart 'yok-kart'/);
    expect(problems((w) => (w.rooms[0].props[0].model = 'Ejderha'))).toMatch(/bilinmeyen model 'Ejderha'/);
  });
  it('kapı ortak duvarda değil', () =>
    expect(problems((w) => (w.doors[0].at.wall = 'north'))).toMatch(/ortak bir duvar hücresi değil/));
  it('pencere başka odaya bakıyor', () =>
    expect(problems((w) => (w.rooms[0].walls.south = { windows: [0] }))).toMatch(/penceresi 0 dışarıya değil 'lab-c1'/));
  it('dizin duvar dışında', () => expect(problems((w) => (w.rooms[1].walls.west = { windows: [7] }))).toMatch(/dizin 7 duvar dışında/));
  it('üst üste binen odalar', () => expect(problems((w) => (w.rooms[1].origin = [-6, -20]))).toMatch(/üst üste biniyor/));
  it('kimsenin sağlamadığı durum', () =>
    expect(problems((w) => (w.faults[2].requires = ['reaktor.acik']))).toMatch(/'reaktor.acik' durumunu istiyor ama hiçbir arıza bunu sağlamıyor/));

  it('döngüsel bağımlılık yolu mesajda', () => {
    const msg = problems((w) => {
      w.faults[0].requires = ['core.online']; // yedek güç ← çekirdek ← yedek güç
    });
    expect(msg).toMatch(/döngüsel bağımlılık: (backup-power → core-terminal → backup-power|core-terminal → backup-power → core-terminal)/);
  });

  it('arıza kendi açtığı kapının arkasında', () => {
    const msg = problems((w) => {
      w.faults[1].room = 'lab-c1'; // kilit paneli kilitlediği kapının öbür tarafına taşındı
      w.faults[1].anchor = { wall: 'east', index: 0, along: 0.5 };
    });
    expect(msg).toMatch(/'door-lock', kendi açtığı kapının arkasında/);
  });

  it('eşya ile terminal çakışması ve engel içindeki giriş', () => {
    expect(problems((w) => (w.faults[0].anchor.index = 1))).toMatch(/eşya\/terminal çakışması/); // dolapla aynı yer
    expect(problems((w) => (w.rooms[0].entrance = { x: -0.77, z: 0.8, yaw: 0 }))).toMatch(/giriş noktası bir engelin içinde/);
  });

  it('geçersiz replik anahtarı', () => {
    const story = { ...(storyJson as Story), lines: { ...storyJson.lines, 'enter:sonar': ['…'] } };
    expect(validateWorld(clone(), { ...ctx, story }).join('\n')).toMatch(/'enter:sonar' hiçbir/);
  });

  it('zorluk ayarı çözülemezse yükleme açıklamalı hata verir', () => {
    const raw = structuredClone(worldJson);
    (raw.rooms[1].difficulty as { trace?: { ops: number[] } }).trace = { ops: [3, 4] }; // hiçbir şablon bu kadar kısa değil
    expect(() => loadWorld(raw, storyJson as Story, CARDS, { verifySeeds: 3 })).toThrow(/zorluk ayarıyla doğrulanabilir problem üretilemiyor/);
  });
});

describe('requires / provides', () => {
  const core = W.faults.find((f) => f.id === 'core-terminal')!;
  const backup = W.faults.find((f) => f.id === 'backup-power')!;
  const lock = W.faults.find((f) => f.id === 'door-lock')!;

  it('koşul yokken bilgisayar engelli; yedek güç çözülünce açılır', () => {
    expect(missingFor(core, [])).toEqual(['power.backup']);
    expect(missingFor(core, withProvided([], backup))).toEqual([]);
  });

  it('kilit çözülünce kapı açılır, oda 2 ulaşılabilir olur', () => {
    expect(openDoors(W, []).size).toBe(0);
    expect(reachableRooms(W, [])).toEqual(new Set(['corridor-b2']));
    const s = withProvided([], lock);
    expect(openDoors(W, s)).toEqual(new Set(['b2-c1']));
    expect(reachableRooms(W, s)).toEqual(new Set(['corridor-b2', 'lab-c1']));
  });

  it('geri dönüş: bilgisayar engelliyken hedef koridordaki yedek güç panosu', () => {
    const s = withProvided([], lock);
    expect(nextGoal(W, s, new Set(['door-lock']), core)?.id).toBe('backup-power');
    // Yedek güç zaten çözülmüşse hedef yok
    expect(nextGoal(W, withProvided(s, backup), new Set(['door-lock', 'backup-power']), core)).toBeNull();
  });

  it('sabit nokta: her arıza çözülebilir, her oda ulaşılabilir', () => {
    const sim = simulate(W);
    expect(sim.unsolvable).toEqual([]);
    expect(sim.unreachableRooms).toEqual([]);
    expect(sim.order.indexOf('backup-power')).toBeLessThan(sim.order.indexOf('core-terminal'));
    expect(findCycle(W)).toBeNull();
  });
});

describe('yerleşim', () => {
  const L = buildWorldLayout(W);

  it('koridor: başlangıçtan kapıya ortada en az 2 m engelsiz yol (eski kural korunur)', () => {
    const half = CLEAR_PATH / 2;
    const entrance = W.rooms[0].entrance;
    const blocking = L.colliders.filter((r) => r.maxX > -half && r.minX < half && r.maxZ > -26 + 0.5 && r.minZ < entrance.z);
    expect(blocking).toEqual([]);
  });

  it('kapı boşluğu iki odada da açık: koridordan oda 2 girişine düz yol serbest', () => {
    for (let z = -20; z > W.rooms[1].entrance.z; z -= 0.1) expect(insideAny(L.colliders, 0, z), `z=${z}`).toBe(false);
    expect(L.doors[0]).toMatchObject({ x: 0, z: -26, rotY: 0 });
  });

  it('oda çevresi kapalı: duvarların dışı her yerde engel', () => {
    for (const { rect: c, def } of L.rooms) {
      const midX = (c.minX + c.maxX) / 2;
      const midZ = (c.minZ + c.maxZ) / 2;
      expect(insideAny(L.colliders, c.minX + WALL_INNER - 2 + 0.1, midZ), `${def.id} batı`).toBe(true);
      expect(insideAny(L.colliders, c.maxX - 0.3, midZ), `${def.id} doğu`).toBe(true);
      if (def.id === 'lab-c1') expect(insideAny(L.colliders, midX, c.minZ + 0.3), 'lab güney').toBe(true);
    }
  });

  it('pencereler yalnız dış cepheye bakıyor (dışa normal yönünde oda yok)', () => {
    expect(L.windows.length).toBe(5);
    for (const w of L.windows) expect(roomAt(L, w.x + w.nx * 2, w.z + w.nz * 2)).toBeNull();
  });

  it('terminaller duvara yaslı ve koşul göstergeleri için odalarında', () => {
    for (const t of L.terminals) expect(roomAt(L, t.x, t.z)).toBe(t.fault.room);
    const lock = L.terminals.find((t) => t.fault.id === 'door-lock')!;
    expect(lock).toMatchObject({ rotY: 0 });
    expect(lock.x).toBeCloseTo(-1.33, 6);
    expect(lock.z).toBeCloseTo(-23.8, 6);
    expect(lock.collider.minY).toBe(1.1); // eğilerek altından geçilebilir
  });

  it('oda köşeleri kapalı: kapısız her köşede kolon ve duvar içinde kalan dolgu bloğu', () => {
    // koridorun güney ucu kapı (2 köşe atlanır), oda 2'nin kapısı köşede değil
    expect(L.cornerFills.length).toBe(6);
    for (const { rect: r } of L.rooms) {
      for (const [x, z] of [[r.minX, r.maxZ], [r.maxX, r.maxZ], [r.minX, r.minZ], [r.maxX, r.minZ]]) {
        const f = L.cornerFills.find((c) => c.minX < x && x < c.maxX && c.minZ < z && z < c.maxZ);
        if (!f) continue;
        // içeri uzanım duvar iç yüzünün gerisinde: oyuncu tarafına taşmaz
        expect(Math.min(Math.abs(f.minX - x), Math.abs(f.maxX - x))).toBeLessThan(WALL_DEPTH);
        expect(Math.min(Math.abs(f.minZ - z), Math.abs(f.maxZ - z))).toBeLessThan(WALL_DEPTH);
        expect(L.placements.some((p) => p.model === 'Column_Simple' && Math.hypot(p.x - x, p.z - z) < 0.7)).toBe(true);
      }
    }
  });

  it('roomAt: oyuncunun bulunduğu oda', () => {
    expect(roomAt(L, 0, -10)).toBe('corridor-b2');
    expect(roomAt(L, 3, -30)).toBe('lab-c1');
    expect(roomAt(L, -20, -10)).toBeNull();
  });
});

describe('kritik kaynakta oda girişinden yeniden başlama', () => {
  const B = parseBalance(balanceJson);
  const count = (id: string) => ({ 'door-lock': 2, 'backup-power': 1, 'core-terminal': 2 })[id] ?? 1;
  const p = (() => {
    const x = defaultProgress(B, 'corridor-b2');
    x.faults = { 'door-lock': { stagesDone: 2 }, 'backup-power': { stagesDone: 1 }, 'core-terminal': { stagesDone: 1 } };
    x.world.states = ['door.b2c1.unlocked', 'power.backup'];
    x.world.discovered = ['corridor-b2', 'lab-c1'];
    x.world.room = 'lab-c1';
    x.resources = { ...x.resources, values: { oxygen: 12, power: 40 } };
    x.resources.damages = [
      { faultId: 'core-terminal#1', source: 'led_burnt', label: 'duman', drainPerMinute: { oxygen: 0.6 } },
      { faultId: 'other-room#0', source: 'dim', label: 'kaçak', drainPerMinute: { oxygen: 0.5 } },
    ];
    x.episode = 3;
    return x;
  })();
  const r = respawnInRoom(p, B, W, 'lab-c1', count);

  it('kaynaklar başa döner, bölüm sayacı artar, oda aynı', () => {
    expect(r.resources.values).toEqual({ oxygen: 100, power: 100 });
    expect(r.episode).toBe(4);
    expect(r.world.room).toBe('lab-c1');
  });

  it('o odadaki tamamlanmamış arıza baştan; önceki odalar çözülmüş kalır', () => {
    expect(r.faults['core-terminal']).toEqual({ stagesDone: 0 });
    expect(r.faults['door-lock']).toEqual({ stagesDone: 2 });
    expect(r.faults['backup-power']).toEqual({ stagesDone: 1 });
    expect(r.world.states).toEqual(['door.b2c1.unlocked', 'power.backup']);
    expect(r.world.discovered).toEqual(['corridor-b2', 'lab-c1']);
  });

  it('yalnız o odanın kalıcı hasarı silinir', () => {
    expect(r.resources.damages.map((d) => d.faultId)).toEqual(['other-room#0']);
  });
});
