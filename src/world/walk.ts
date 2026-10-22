// Yürünebilirlik: dünya, oyuncu gövdesi yarıçapı kadar şişirilmiş çarpışma kutularıyla 0,2 m'lik ızgaraya
// dökülür; başlangıç odasının girişinden genişlik öncelikli arama yapılır. Kapılar açık sayılır (her kapı
// oyunda bir gün açılır). Her terminalin önü, her odanın girişi ve her kapının iki yanı erişilebilir olmalı.
// Eğilerek altından geçilen kutular (alt kenarı gövde yüksekliğinden yüksek) engel sayılmaz.

import { roomAt, TERMINAL_SPEC, type WorldLayout } from './layout';
import { INWARD } from './layout';

export const PLAYER_RADIUS = 0.3;
/** Ayaktaki gövde yüksekliği (hub/movement.ts BODY.stand ile aynı). */
const BODY = 1.75;
const CELL = 0.2;

export interface WalkTarget {
  label: string;
  x: number;
  z: number;
}

export function walkTargets(L: WorldLayout): WalkTarget[] {
  const out: WalkTarget[] = [];
  for (const t of L.terminals) {
    const [nx, nz] = INWARD[t.fault.anchor.wall];
    const d = 1.0 + (TERMINAL_SPEC[t.model].depth - TERMINAL_SPEC[t.model].backDepth);
    out.push({ label: `terminal '${t.fault.id}'`, x: t.x + nx * d, z: t.z + nz * d });
  }
  for (const { def } of L.rooms) out.push({ label: `oda '${def.id}' girişi`, x: def.entrance.x, z: def.entrance.z });
  for (const d of L.doors) {
    const ns = Math.abs(d.rotY) < 1e-6;
    for (const s of [-1, 1]) out.push({ label: `kapı '${d.def.id}'`, x: d.x + (ns ? 0 : s * 0.9), z: d.z + (ns ? s * 0.9 : 0) });
  }
  return out;
}

/**
 * Erişilemeyen hedeflerin listesi (boşsa her yer yürünebilir). `closedDoors` verilirse o kapıların açıklığı engel
 * sayılır (oyunun belirli bir anındaki durum); `targets` verilmezse bütün terminaller, girişler ve kapılar.
 */
export function unreachable(L: WorldLayout, opts: { closedDoors?: ReadonlySet<string>; targets?: WalkTarget[] } = {}): WalkTarget[] {
  const b = L.bounds;
  const nx = Math.ceil((b.maxX - b.minX) / CELL) + 1;
  const nz = Math.ceil((b.maxZ - b.minZ) / CELL) + 1;
  const blocked = new Uint8Array(nx * nz);
  const ix = (x: number) => Math.round((x - b.minX) / CELL);
  const iz = (z: number) => Math.round((z - b.minZ) / CELL);
  // Oda dışı her yer kapalı
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) if (roomAt(L, b.minX + i * CELL, b.minZ + k * CELL) === null) blocked[i * nz + k] = 1;
  for (const c of L.colliders) {
    if ((c.minY ?? 0) >= BODY) continue;
    const x0 = Math.max(0, Math.ceil((c.minX - PLAYER_RADIUS - b.minX) / CELL));
    const x1 = Math.min(nx - 1, Math.floor((c.maxX + PLAYER_RADIUS - b.minX) / CELL));
    const z0 = Math.max(0, Math.ceil((c.minZ - PLAYER_RADIUS - b.minZ) / CELL));
    const z1 = Math.min(nz - 1, Math.floor((c.maxZ + PLAYER_RADIUS - b.minZ) / CELL));
    for (let i = x0; i <= x1; i++) for (let k = z0; k <= z1; k++) blocked[i * nz + k] = 1;
  }
  for (const d of L.doors) {
    if (!opts.closedDoors?.has(d.def.id)) continue;
    const ns = Math.abs(d.rotY) < 1e-6; // kuzey/güney duvarında: açıklık x boyunca
    const [hx, hz] = ns ? [1.4, 0.4] : [0.4, 1.4];
    for (let i = Math.max(0, ix(d.x - hx)); i <= Math.min(nx - 1, ix(d.x + hx)); i++)
      for (let k = Math.max(0, iz(d.z - hz)); k <= Math.min(nz - 1, iz(d.z + hz)); k++) blocked[i * nz + k] = 1;
  }
  const start = L.rooms.find((r) => r.def.id === L.world.start.room)!.def.entrance;
  const seen = new Uint8Array(nx * nz);
  const queue: number[] = [];
  const push = (i: number, k: number) => {
    if (i < 0 || k < 0 || i >= nx || k >= nz) return;
    const id = i * nz + k;
    if (seen[id] || blocked[id]) return;
    seen[id] = 1;
    queue.push(id);
  };
  push(ix(start.x), iz(start.z));
  for (let q = 0; q < queue.length; q++) {
    const i = Math.floor(queue[q] / nz);
    const k = queue[q] % nz;
    push(i + 1, k);
    push(i - 1, k);
    push(i, k + 1);
    push(i, k - 1);
  }
  /** Hedefin çevresinde (±1 hücre) erişilen bir hücre var mı. */
  const reached = (x: number, z: number) => {
    for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
      const i = ix(x) + di;
      const k = iz(z) + dk;
      if (i >= 0 && k >= 0 && i < nx && k < nz && seen[i * nz + k]) return true;
    }
    return false;
  };
  return (opts.targets ?? walkTargets(L)).filter((t) => !reached(t.x, t.z));
}
