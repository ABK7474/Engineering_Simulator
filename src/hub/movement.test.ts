import { describe, expect, it } from 'vitest';
import worldJson from '../../content/world/season1-world.json';
import { buildWorldLayout } from '../world/layout';
import { parseWorld } from '../world/schema';
import {
  BODY,
  blocksBody,
  canStand,
  EYE,
  moveMode,
  createSprint,
  DOUBLE_TAP_MS,
  noiseLevel,
  RUN_FACTOR,
  speedFor,
  stepProfile,
  stepsPerSecond,
  WALK_SPEED,
  type Aabb,
} from './movement';

const box = (x0: number, x1: number, z0: number, z1: number, y0 = -1, y1 = 6): Aabb => ({
  min: { x: x0, y: y0, z: z0 },
  max: { x: x1, y: y1, z: z1 },
});

describe('hareket kipi ve hız', () => {
  it('kip: hareketsiz, yürüme, koşma, eğilme (koşmayı bastırır)', () => {
    expect(moveMode({ moving: false, run: true, crouched: false })).toBe('idle');
    expect(moveMode({ moving: true, run: false, crouched: false })).toBe('walk');
    expect(moveMode({ moving: true, run: true, crouched: false })).toBe('run');
    expect(moveMode({ moving: true, run: true, crouched: true })).toBe('crouch');
  });

  it('koşma yürümenin ~1,6 katı, eğilme daha yavaş', () => {
    expect(RUN_FACTOR).toBeCloseTo(1.6, 10);
    expect(speedFor('run')).toBeCloseTo(WALK_SPEED * 1.6, 10);
    expect(speedFor('crouch')).toBeLessThan(speedFor('walk'));
    expect(speedFor('idle')).toBe(0);
  });

  it('eğilince kamera ve gövde alçalır', () => {
    expect(EYE.crouch).toBeLessThan(EYE.stand);
    expect(BODY.crouch).toBeLessThan(BODY.stand);
  });
});

describe('çift dokunuşla koşma (W W)', () => {
  it('kısa aralıkla iki dokunuş koşuyu başlatır, ileri bırakılınca biter', () => {
    const s = createSprint();
    s.forwardDown(1000);
    expect(s.sprinting).toBe(false);
    s.forwardUp();
    s.forwardDown(1000 + DOUBLE_TAP_MS - 50);
    expect(s.sprinting).toBe(true);
    s.forwardUp();
    expect(s.sprinting).toBe(false);
  });
  it('yavaş iki dokunuş ve basılı tutma (tuş tekrarı) koşturmaz', () => {
    const s = createSprint();
    s.forwardDown(0);
    s.forwardDown(DOUBLE_TAP_MS + 1);
    expect(s.sprinting).toBe(false);
    const h = createSprint();
    h.forwardDown(0);
    h.forwardDown(30, true);
    h.forwardDown(60, true);
    expect(h.sprinting).toBe(false);
  });
  it('eğilme koşuyu keser; üçüncü dokunuş tek başına yeniden başlatmaz', () => {
    const s = createSprint();
    s.forwardDown(0);
    s.forwardDown(100);
    s.cancel();
    expect(s.sprinting).toBe(false);
    s.forwardDown(200);
    expect(s.sprinting).toBe(false);
  });
});

describe('gürültü seviyesi', () => {
  it('eğilme 0, yürüme 1, koşma 2; hareketsiz 0', () => {
    expect(noiseLevel('crouch')).toBe(0);
    expect(noiseLevel('walk')).toBe(1);
    expect(noiseLevel('run')).toBe(2);
    expect(noiseLevel('idle')).toBe(0);
  });
});

describe('adım sesi profili', () => {
  it('koşarken sık ve yüksek, eğilirken seyrek ve kısık', () => {
    expect(stepsPerSecond('run')).toBeGreaterThan(stepsPerSecond('walk'));
    expect(stepsPerSecond('crouch')).toBeLessThan(stepsPerSecond('walk'));
    expect(stepProfile('run').volume).toBeGreaterThan(stepProfile('walk').volume);
    expect(stepProfile('crouch').volume).toBeLessThan(stepProfile('walk').volume);
    expect(stepsPerSecond('idle')).toBe(0);
  });
});

describe('yüksekliğe bağlı çarpışma', () => {
  // Duvar terminali: yerden 1,1 m yukarıda başlıyor
  const terminal = box(-1.55, -1.11, -24, -23, 1.1, 1.6);

  it('ayaktaki oyuncuyu durdurur, eğilen oyuncu altından geçer', () => {
    expect(blocksBody(terminal, BODY.stand)).toBe(true);
    expect(blocksBody(terminal, BODY.crouch)).toBe(false);
    expect(blocksBody(box(0, 1, 0, 1), BODY.crouch)).toBe(true); // yerden tavana duvar herkesi durdurur
  });

  it('terminalin altında ayağa kalkılamaz, açıkta kalkılır', () => {
    expect(canStand(-1.3, -23.5, 0.3, [terminal])).toBe(false);
    expect(canStand(0, -23.5, 0.3, [terminal])).toBe(true);
  });

  it('koridordaki terminal çarpışma kutusu eğilerek geçilebilir', () => {
    const L = buildWorldLayout(parseWorld(worldJson));
    const t = L.colliders.find((r) => r.minY !== undefined)!;
    expect(t.minY).toBeGreaterThan(BODY.crouch);
    expect(t.minY).toBeLessThan(BODY.stand);
  });
});
