// Kodla üretilen dokular (canvas): yüzey bozulması atlası (pas, damlama, su lekesi, kurum), tabela atlası,
// animasyonlu ekranlar ve yumuşak parçacık sprite'ı. Deterministik (tohumlu RNG) ki her açılışta aynı görünsün.

import * as THREE from 'three';
import { createRng, type Rng } from '../core/rng';
import type { GrimeKind, ScreenKind, Sign } from '../world/dressing';

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

// ---------------------------------------------------------------- yüzey bozulması

export const GRIME_ROWS: Record<GrimeKind, number> = { rust: 0, drip: 1, water: 2, dirt: 3 };
const TILE_W = 128;
const TILE_H = 256;

function rustTile(g: CanvasRenderingContext2D, rng: Rng, x0: number, y0: number) {
  // Üstte yoğun, aşağı doğru incelen turuncu-kahve akıntılar
  for (let k = 0; k < 26; k++) {
    const x = x0 + 8 + rng() * (TILE_W - 16);
    const len = TILE_H * (0.3 + rng() * 0.65);
    const w = 2 + rng() * 9;
    const grad = g.createLinearGradient(0, y0, 0, y0 + len);
    const a = 0.25 + rng() * 0.45;
    grad.addColorStop(0, `rgba(${120 + rng() * 60},${55 + rng() * 25},${18 + rng() * 10},${a})`);
    grad.addColorStop(0.6, `rgba(90,42,16,${a * 0.5})`);
    grad.addColorStop(1, 'rgba(70,35,15,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - w, y0);
    g.quadraticCurveTo(x + (rng() - 0.5) * 6, y0 + len * 0.5, x, y0 + len);
    g.quadraticCurveTo(x + (rng() - 0.5) * 6, y0 + len * 0.5, x + w, y0);
    g.fill();
  }
  // Pas lekeleri
  for (let k = 0; k < 30; k++) {
    g.fillStyle = `rgba(${110 + rng() * 50},${45 + rng() * 20},15,${0.15 + rng() * 0.3})`;
    g.beginPath();
    g.arc(x0 + rng() * TILE_W, y0 + rng() * TILE_H * 0.35, 1 + rng() * 7, 0, Math.PI * 2);
    g.fill();
  }
}

function dripTile(g: CanvasRenderingContext2D, rng: Rng, x0: number, y0: number) {
  // Koyu, ince su izleri ve uçlarında damla
  for (let k = 0; k < 14; k++) {
    const x = x0 + 6 + rng() * (TILE_W - 12);
    const len = TILE_H * (0.35 + rng() * 0.6);
    const w = 1 + rng() * 3;
    const grad = g.createLinearGradient(0, y0, 0, y0 + len);
    grad.addColorStop(0, 'rgba(10,22,24,0.55)');
    grad.addColorStop(1, 'rgba(10,22,24,0.08)');
    g.fillStyle = grad;
    g.fillRect(x, y0, w, len);
    g.fillStyle = 'rgba(8,18,20,0.5)';
    g.beginPath();
    g.ellipse(x + w / 2, y0 + len, w * 1.3, w * 1.8, 0, 0, Math.PI * 2);
    g.fill();
  }
  const grad = g.createLinearGradient(0, y0, 0, y0 + 40);
  grad.addColorStop(0, 'rgba(10,25,28,0.45)');
  grad.addColorStop(1, 'rgba(10,25,28,0)');
  g.fillStyle = grad;
  g.fillRect(x0, y0, TILE_W, 40);
}

function waterTile(g: CanvasRenderingContext2D, rng: Rng, x0: number, y0: number) {
  // Düzensiz leke, koyu kenar halkası (kurumuş su izi ya da zemin birikintisi)
  const cx = x0 + TILE_W / 2;
  const cy = y0 + TILE_H / 2;
  for (let ring = 0; ring < 3; ring++) {
    g.beginPath();
    const n = 18;
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * Math.PI * 2;
      const r = (0.32 - ring * 0.07 + (rng() - 0.5) * 0.08) * TILE_W;
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r * 1.8;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = `rgba(14,32,36,${0.18 + ring * 0.1})`;
    g.fill();
    g.strokeStyle = `rgba(40,30,20,${0.25 - ring * 0.06})`;
    g.lineWidth = 3;
    g.stroke();
  }
}

function dirtTile(g: CanvasRenderingContext2D, rng: Rng, x0: number, y0: number) {
  // Altta yoğun kurum/kir; yukarı doğru seyrelir
  for (let k = 0; k < 220; k++) {
    const y = y0 + TILE_H * (1 - Math.pow(rng(), 2));
    const a = 0.04 + 0.14 * ((y - y0) / TILE_H);
    g.fillStyle = `rgba(18,16,14,${a})`;
    g.beginPath();
    g.arc(x0 + rng() * TILE_W, y, 2 + rng() * 9, 0, Math.PI * 2);
    g.fill();
  }
}

/** 4 tür (satır) × 4 varyant (sütun) atlas. */
export function grimeAtlas(): THREE.CanvasTexture {
  const c = canvas(TILE_W * 4, TILE_H * 4);
  const g = c.getContext('2d')!;
  const rng = createRng(7);
  const draw = [rustTile, dripTile, waterTile, dirtTile];
  draw.forEach((fn, row) => {
    for (let col = 0; col < 4; col++) {
      g.save();
      g.beginPath();
      g.rect(col * TILE_W, row * TILE_H, TILE_W, TILE_H);
      g.clip();
      fn(g, rng, col * TILE_W, row * TILE_H);
      g.restore();
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- tabelalar

export const SIGN_W = 512;
export const SIGN_H = 160;

/** Tabelaları tek atlasa çizer; dönen dizin her tabelanın karosu. */
export function signAtlas(signs: readonly Sign[]): { texture: THREE.CanvasTexture; cols: number; rows: number } {
  const cols = 2;
  const rows = Math.max(1, Math.ceil(signs.length / cols));
  const c = canvas(SIGN_W * cols, SIGN_H * rows);
  const g = c.getContext('2d')!;
  signs.forEach((s, k) => {
    const x = (k % cols) * SIGN_W;
    const y = Math.floor(k / cols) * SIGN_H;
    const warn = s.kind === 'warning';
    g.fillStyle = warn ? '#d9a21b' : '#0d3b40';
    g.fillRect(x, y, SIGN_W, SIGN_H);
    if (warn) {
      // Sarı-siyah ikaz şeridi
      g.save();
      g.beginPath();
      g.rect(x, y, SIGN_W, 22);
      g.rect(x, y + SIGN_H - 22, SIGN_W, 22);
      g.clip();
      g.fillStyle = '#151515';
      for (let k2 = -2; k2 < 20; k2++) {
        g.beginPath();
        g.moveTo(x + k2 * 36, y);
        g.lineTo(x + k2 * 36 + 18, y);
        g.lineTo(x + k2 * 36 + 18 + SIGN_H, y + SIGN_H);
        g.lineTo(x + k2 * 36 + SIGN_H, y + SIGN_H);
        g.fill();
      }
      g.restore();
    } else {
      g.strokeStyle = '#3fd6d0';
      g.lineWidth = 5;
      g.strokeRect(x + 6, y + 6, SIGN_W - 12, SIGN_H - 12);
    }
    g.textAlign = 'center';
    g.fillStyle = warn ? '#141414' : '#d6f6f4';
    g.font = `bold ${warn ? 44 : 48}px system-ui, sans-serif`;
    fitText(g, s.title, x + SIGN_W / 2, y + (warn ? 80 : 74), SIGN_W - 40);
    g.font = `${warn ? 26 : 28}px system-ui, sans-serif`;
    g.fillStyle = warn ? '#2a2a2a' : '#8fd8d4';
    fitText(g, s.sub, x + SIGN_W / 2, y + (warn ? 118 : 120), SIGN_W - 40);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, cols, rows };
}

function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  const w = g.measureText(text).width;
  if (w > maxW) {
    g.save();
    g.translate(x, y);
    g.scale(maxW / w, 1);
    g.fillText(text, 0, 0);
    g.restore();
  } else g.fillText(text, x, y);
}

// ---------------------------------------------------------------- ekranlar

const LOG_LINES = [
  'BASINÇ 3,2 bar · SABİT',
  'O₂ %20,8 · CO₂ 0,4 kPa',
  'SOĞUTMA DÖNGÜSÜ: AKIŞ DÜŞÜK',
  'KAYIT 0417: KAPI B2-C1 KİLİTLİ',
  'NEREUS: kayıt düzenleniyor…',
  'SONAR: dinleme kipi',
  'GÖVDE GERİLİMİ ±0,02 mm',
  'YEDEK GÜÇ: %38',
  'DIŞ SICAKLIK 3,9 °C',
  'BAĞLANTI: yüzey hattı yok',
  'BAKIM ERTELENDİ (312 gün)',
];

/** Animasyonlu ekran: bir tür için tek tuval, bütün o türden ekranlar paylaşır. */
export class ScreenCanvas {
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private c: HTMLCanvasElement;
  private t = 0;
  constructor(readonly kind: ScreenKind) {
    this.c = canvas(256, 160);
    this.g = this.c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw(0);
  }

  /** Saniyede birkaç kez çağrılır. */
  draw(time: number): void {
    const { g } = this;
    this.t = time;
    g.fillStyle = '#04161a';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = 'rgba(63,214,208,0.12)';
    g.lineWidth = 1;
    for (let x = 0; x <= 256; x += 32) g.strokeRect(x, 0, 0.5, 160);
    for (let y = 0; y <= 160; y += 32) g.strokeRect(0, y, 256, 0.5);
    if (this.kind === 'wave' || this.kind === 'sonar') {
      g.strokeStyle = this.kind === 'sonar' ? '#58ffb0' : '#3fd6d0';
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= 256; x += 2) {
        const p = x / 256;
        const y = 80 + Math.sin(p * 18 + this.t * 3) * 28 * Math.sin(p * 3.1 + this.t * 0.7) + Math.sin(p * 61 + this.t * 11) * 4;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = '#ffb030';
      g.font = 'bold 14px monospace';
      g.fillText(this.kind === 'sonar' ? 'SONAR' : 'SİNYAL', 8, 18);
    } else if (this.kind === 'graph') {
      for (let k = 0; k < 10; k++) {
        const h = 30 + 90 * (0.5 + 0.5 * Math.sin(k * 1.7 + this.t * (0.6 + k * 0.05)));
        g.fillStyle = h > 100 ? '#ff9040' : '#3fd6d0';
        g.fillRect(14 + k * 23, 150 - h, 16, h);
      }
    } else {
      g.font = '13px monospace';
      const start = Math.floor(this.t * 1.5);
      for (let k = 0; k < 8; k++) {
        const line = LOG_LINES[(start + k) % LOG_LINES.length];
        g.fillStyle = line.includes('DÜŞÜK') || line.includes('KİLİTLİ') ? '#ffb030' : '#9fe8e4';
        g.fillText(line, 8, 20 + k * 18);
      }
      if (Math.floor(this.t * 2) % 2) {
        g.fillStyle = '#9fe8e4';
        g.fillRect(8, 152, 9, 3);
      }
    }
    this.texture.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- parçacık

export function softDot(): THREE.CanvasTexture {
  const c = canvas(64, 64);
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
