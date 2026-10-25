// Deniz canlıları (yalnız pencerelerden görünür, dış grubun içinde): balık sürüleri, denizanaları, yosun,
// biyolüminesan plankton ve uzaktan geçen bir vatoz silüeti. Yaratık yaklaşınca sürüler dağılıp kaçar,
// plankton parlar. Çizim bütçesi: her canlı türü tek çizim çağrısı (örnekli ağ ya da nokta bulutu), toplam
// ~12 bin üçgen; hareketin çoğu köşe gölgelendiricisinde. Saf yerleşim/simülasyon fonksiyonları testli.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import type { Rect, WindowLayout, WorldLayout } from '../world/layout';
import { clearZones, dishSpots, distanceToRects, expand, stationRocks, seabedHeight, WALL_OUT, withWaterFog, type Exterior, type RockSpot } from './exterior';

type V3 = [number, number, number];

// ---------------------------------------------------------------- saf yardımcılar (testli)

/** Nokta dikdörtgenlerden birinin (pad kadar genişletilmiş) içindeyse en yakın kenarın dışına itilir. */
export function pushOutside(rects: readonly Rect[], x: number, z: number, pad: number): [number, number] {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const r of rects) {
      const [x0, x1, z0, z1] = [r.minX - pad, r.maxX + pad, r.minZ - pad, r.maxZ + pad];
      if (x <= x0 || x >= x1 || z <= z0 || z >= z1) continue;
      const exits: [number, number, number][] = [
        [x - x0, x0 - 1e-3, z],
        [x1 - x, x1 + 1e-3, z],
        [z - z0, x, z0 - 1e-3],
        [z1 - z, x, z1 + 1e-3],
      ];
      const [, nx, nz] = exits.reduce((a, b) => (b[0] < a[0] ? b : a));
      [x, z] = [nx, nz];
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}

/** Kayaların ve çanağın üstü: canlılar bu yüksekliğin altına inmez (kayanın içinden geçen balık olmasın). */
export function obstacleFloor(rocks: readonly RockSpot[], dishes: readonly { x: number; z: number }[], x: number, z: number, bed: number): number {
  let floor = bed + 0.5;
  for (const r of rocks) {
    const reach = r.scale * 1.1 * 1.25 + 0.5;
    if (Math.abs(x - r.x) < reach && Math.abs(z - r.z) < reach && Math.hypot(x - r.x, z - r.z) < reach) floor = Math.max(floor, r.y + r.scale * r.squash * 1.25 + 0.4);
  }
  for (const d of dishes) if (Math.hypot(x - d.x, z - d.z) < 3.2) floor = Math.max(floor, bed + 7.5);
  return floor;
}

/** Sürü merkezinin yolu: bir pencerenin önünde, duvara paralel ve dik iki salınımın toplamı (kapalı eğri). */
export interface SchoolPath {
  roomId: string;
  home: V3;
  along: [number, number];
  out: [number, number];
  a: number;
  b: number;
  h: number;
  period: number;
  phase: number;
}

export function schoolCenter(p: SchoolPath, t: number): V3 {
  const th = (t / p.period) * Math.PI * 2 + p.phase;
  const s = Math.sin(th) * p.a;
  const o = Math.sin(2 * th + 0.7) * p.b;
  return [p.home[0] + p.along[0] * s + p.out[0] * o, p.home[1] + Math.sin(th * 3 + 1.3) * p.h, p.home[2] + p.along[1] * s + p.out[1] * o];
}

/** Her odaya bir sürü: pencerelerinden birinin önünde; yolun her noktası iç hacimlerden en az 3 m uzak. */
export function schoolPaths(windows: readonly WindowLayout[], interiors: readonly Rect[], seed = 31): SchoolPath[] {
  const rng = createRng(seed);
  const rooms = [...new Set(windows.map((w) => w.roomId))];
  const out: SchoolPath[] = [];
  for (const roomId of rooms) {
    const ws = windows.filter((w) => w.roomId === roomId);
    for (let tries = 0; tries < 30; tries++) {
      const w = ws[Math.floor(rng() * ws.length)];
      const d = 6.5 + rng() * 4 + tries * 0.15;
      const p: SchoolPath = {
        roomId,
        home: [w.x + w.nx * d, 1.8 + rng() * 2.2, w.z + w.nz * d],
        along: [-w.nz, w.nx],
        out: [w.nx, w.nz],
        a: Math.max(1.5, (4 + rng() * 4) * (1 - tries / 40)),
        b: 1.5 + rng() * 1.5,
        h: 0.4 + rng() * 0.5,
        period: 45 + rng() * 30,
        phase: rng() * Math.PI * 2,
      };
      const ok = Array.from({ length: 48 }, (_, k) => schoolCenter(p, (k / 48) * p.period)).every(([x, , z]) => distanceToRects(interiors, x, z) >= 3);
      if (ok) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

export interface Obstacles {
  interiors: readonly Rect[];
  floor: (x: number, z: number) => number;
}

/**
 * Balık sürüsü simülasyonu (Three.js'siz): her balık sürü merkezinin çevresindeki kendi yerine yay-sönüm
 * kuvvetiyle çekilir. Yaratık yakındaysa balık ondan uzağa itilir, sürünün korkusu artar: merkez kaçar,
 * sürü dağılır, hız sınırı yükselir; korku yaratık gidince birkaç saniyede söner.
 */
export class FishSim {
  readonly n: number;
  readonly school: Uint8Array;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly yaw: Float32Array;
  readonly pitch: Float32Array;
  readonly swim: Float32Array;
  readonly fear: Float32Array;
  private readonly offset: Float32Array;
  private readonly shift: Float32Array;
  nervous = 0;

  constructor(readonly paths: readonly SchoolPath[], perSchool: number, private readonly obs: Obstacles, seed = 9) {
    const rng = createRng(seed);
    this.n = paths.length * perSchool;
    this.school = new Uint8Array(this.n);
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.yaw = new Float32Array(this.n);
    this.pitch = new Float32Array(this.n);
    this.swim = new Float32Array(this.n);
    this.offset = new Float32Array(this.n * 3);
    this.fear = new Float32Array(paths.length);
    this.shift = new Float32Array(paths.length * 3);
    for (let i = 0; i < this.n; i++) {
      const s = Math.floor(i / perSchool);
      this.school[i] = s;
      // Basık elipsoit içinde rastgele yer
      const [u, v, w] = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
      this.offset.set([u * 1.8, v * 0.6, w * 1.8], i * 3);
      const c = schoolCenter(paths[s], 0);
      this.pos.set([c[0] + u * 1.8, c[1] + v * 0.6, c[2] + w * 1.8], i * 3);
      this.yaw[i] = Math.atan2(paths[s].along[0], paths[s].along[1]);
      this.swim[i] = rng() * 6.28;
    }
  }

  /** Okunurluk için: sürünün balıklarının ortalama konumu. */
  centroid(s: number): V3 {
    const c: V3 = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < this.n; i++)
      if (this.school[i] === s) {
        for (let a = 0; a < 3; a++) c[a] += this.pos[i * 3 + a];
        k++;
      }
    return c.map((v) => v / k) as V3;
  }

  step(dt: number, t: number, creature: { x: number; y: number; z: number } | null): void {
    dt = Math.min(dt, 0.1);
    const centers = this.paths.map((p, s) => {
      const c = schoolCenter(p, t);
      let threat = 0;
      if (creature) {
        const dx = c[0] - creature.x;
        const dz = c[2] - creature.z;
        const d = Math.hypot(dx, c[1] - creature.y, dz);
        threat = Math.min(1, Math.max(0, 1 - (d - 8) / 16));
        if (threat > 0) {
          // Merkez yaratığın tersine kayar (yatay)
          const h = Math.hypot(dx, dz) || 1;
          this.shift[s * 3] += ((dx / h) * 10 * threat - this.shift[s * 3]) * Math.min(1, dt * 1.5);
          this.shift[s * 3 + 2] += ((dz / h) * 10 * threat - this.shift[s * 3 + 2]) * Math.min(1, dt * 1.5);
        }
      }
      this.fear[s] = Math.max(this.fear[s] * Math.exp(-dt / 4), threat);
      if (threat === 0) for (const a of [0, 2]) this.shift[s * 3 + a] *= Math.exp(-dt / 6);
      const [x, z] = pushOutside(this.obs.interiors, c[0] + this.shift[s * 3], c[2] + this.shift[s * 3 + 2], 2);
      return [x, c[1], z] as V3;
    });
    const swirl = t * 0.12;
    const [cs, sn] = [Math.cos(swirl), Math.sin(swirl)];
    for (let i = 0; i < this.n; i++) {
      const s = this.school[i];
      const fear = this.fear[s];
      const spread = 1 + fear * 1.3 + this.nervous * 0.4;
      const o = i * 3;
      const [ox, oy, oz] = [this.offset[o], this.offset[o + 1], this.offset[o + 2]];
      const tx = centers[s][0] + (ox * cs - oz * sn) * spread;
      const ty = centers[s][1] + oy * spread;
      const tz = centers[s][2] + (ox * sn + oz * cs) * spread;
      const p = this.pos;
      const v = this.vel;
      let ax = (tx - p[o]) * 1.2 - v[o] * 1.0;
      let ay = (ty - p[o + 1]) * 1.2 - v[o + 1] * 1.4;
      let az = (tz - p[o + 2]) * 1.2 - v[o + 2] * 1.0;
      if (creature) {
        const dx = p[o] - creature.x;
        const dy = p[o + 1] - creature.y;
        const dz = p[o + 2] - creature.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        if (d < 14) {
          const k = (22 * (1 - d / 14)) / d;
          ax += dx * k;
          ay += dy * k * 0.4;
          az += dz * k;
        }
      }
      v[o] += ax * dt;
      v[o + 1] += ay * dt;
      v[o + 2] += az * dt;
      const vmax = 1.4 + fear * 5 + this.nervous * 0.8;
      const sp = Math.hypot(v[o], v[o + 1], v[o + 2]);
      if (sp > vmax) for (let a = 0; a < 3; a++) v[o + a] *= vmax / sp;
      p[o] += v[o] * dt;
      p[o + 1] += v[o + 1] * dt;
      p[o + 2] += v[o + 2] * dt;
      const [x, z] = pushOutside(this.obs.interiors, p[o], p[o + 2], 0.6);
      p[o] = x;
      p[o + 2] = z;
      const floor = this.obs.floor(x, z);
      if (p[o + 1] < floor) {
        p[o + 1] = floor;
        v[o + 1] = Math.max(v[o + 1], 0);
      }
      if (p[o + 1] > 11) p[o + 1] = 11;
      // Yön hıza göre yumuşakça döner; kuyruk hızla daha sık çırpar
      const spd = Math.min(sp, vmax);
      if (spd > 0.05) {
        const want = Math.atan2(v[o], v[o + 2]);
        let dyaw = want - this.yaw[i];
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        this.yaw[i] += dyaw * Math.min(1, dt * 6);
        this.pitch[i] += (-Math.asin(Math.max(-0.6, Math.min(0.6, v[o + 1] / spd))) - this.pitch[i]) * Math.min(1, dt * 4);
      }
      this.swim[i] += dt * (5 + spd * 6);
    }
  }
}

export interface Spot {
  x: number;
  y: number;
  z: number;
  scale: number;
  phase: number;
}

/** Kayalara, çanağa ve iç hacimlere değmeyen, pencerelerin önünde bir nokta (bulamazsa null). */
function clearPoint(rng: () => number, windows: readonly WindowLayout[], interiors: readonly Rect[], rocks: readonly RockSpot[], dishes: readonly { x: number; z: number }[], dist: [number, number], pad: number, rockPad: number): [number, number] | null {
  for (let tries = 0; tries < 60; tries++) {
    const w = windows[Math.floor(rng() * windows.length)];
    const d = dist[0] + rng() * (dist[1] - dist[0]);
    const l = (rng() - 0.5) * 2 * 6;
    const x = w.x + w.nx * d - w.nz * l;
    const z = w.z + w.nz * d + w.nx * l;
    if (distanceToRects(interiors, x, z) < pad) continue;
    if (rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.scale * 1.1 * 1.25 + rockPad)) continue;
    if (dishes.some((s) => Math.hypot(x - s.x, z - s.z) < 3.5 + rockPad)) continue;
    return [x, z];
  }
  return null;
}

/** Yosun kümeleri: deniz tabanına gömülü kök, kayalara ve çanağa değmez (deterministik). */
export function kelpLayout(windows: readonly WindowLayout[], interiors: readonly Rect[], rocks: readonly RockSpot[], dishes: readonly { x: number; z: number }[], seed = 515, avoid: readonly Rect[] = []): Spot[] {
  const blockers = [...interiors, ...avoid];
  const rng = createRng(seed);
  const out: Spot[] = [];
  const rooms = [...new Set(windows.map((w) => w.roomId))];
  for (const roomId of rooms) {
    const ws = windows.filter((w) => w.roomId === roomId);
    for (let c = 0; c < 2; c++) {
      const center = clearPoint(rng, ws, blockers, rocks, dishes, [3.5, 13], 2.5, 1);
      if (!center) continue;
      const n = 7 + Math.floor(rng() * 8);
      for (let k = 0; k < n; k++) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 1.6;
        const x = center[0] + Math.cos(a) * r;
        const z = center[1] + Math.sin(a) * r;
        if (distanceToRects(blockers, x, z) < 1.4) continue;
        if (rocks.some((q) => Math.hypot(x - q.x, z - q.z) < q.scale * 1.1 * 1.25 + 0.3)) continue;
        // Kök tabanın 0,6 m altında: taban ağı fonksiyonu köşeler arasında doğrusal yaklaştırır
        out.push({ x, z, y: seabedHeight(x, z, distanceToRects(interiors, x, z)) - 0.6, scale: 1.8 + rng() * 3, phase: rng() * Math.PI * 2 });
      }
    }
  }
  return out;
}

/** Denizanaları: suda asılı, kayaların ve çanağın üstüne binmeyen yerlerde (deterministik). */
export function jellyLayout(windows: readonly WindowLayout[], interiors: readonly Rect[], rocks: readonly RockSpot[], dishes: readonly { x: number; z: number }[], count = 18, seed = 808, avoid: readonly Rect[] = []): Spot[] {
  const blockers = [...interiors, ...avoid];
  const rng = createRng(seed);
  const out: Spot[] = [];
  for (let k = 0; k < count * 3 && out.length < count; k++) {
    // Sürüklenme yarıçapı ≤ 1,7 m: kayalardan o kadar fazladan uzak
    const p = clearPoint(rng, windows, blockers, rocks, dishes, [3, 15], 2.5, 1.9);
    if (!p) continue;
    out.push({ x: p[0], z: p[1], y: 1.8 + rng() * 6, scale: 0.6 + rng() * 0.9, phase: rng() * Math.PI * 2 });
  }
  return out;
}

// ---------------------------------------------------------------- gölgelendirici yardımcıları

/** Malzemenin köşe aşamasına (dünya dönüşümünden önce, yerel uzayda) kod ekler; su sisi korunur. */
function withVertex<M extends THREE.Material>(m: M, key: string, uniforms: Record<string, THREE.IUniform>, decl: string, code: string): M {
  withWaterFog(m);
  const fog = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    fog.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${decl}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${code}`);
  };
  // Program önbelleği onBeforeCompile metnine bakar; sarmalayıcı her malzemede aynı olduğundan anahtar şart
  m.customProgramCacheKey = () => `sealife-${key}`;
  return m;
}

function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 7, 5).scale(0.045, 0.085, 0.2);
  body.deleteAttribute('uv');
  // Kuyruk yüzgeci: dikey üçgen
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.16, 0, 0.1, -0.32, 0, -0.1, -0.32], 3));
  tail.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  const dorsal = new THREE.BufferGeometry();
  dorsal.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.07, 0.06, 0, 0.13, -0.04, 0, 0.07, -0.08], 3));
  dorsal.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  return mergeGeometries([body.toNonIndexed(), tail, dorsal]);
}

function kelpGeometry(): THREE.BufferGeometry {
  const blade = (rot: number) => {
    const g = new THREE.PlaneGeometry(0.32, 1, 1, 7).translate(0, 0.5, 0);
    const p = g.getAttribute('position');
    // Yukarı doğru incelen, hafif dalgalı yaprak
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 - p.getY(i) * 0.6) * (1 + 0.25 * Math.sin(p.getY(i) * 9)));
    g.deleteAttribute('uv');
    return g.rotateY(rot);
  };
  return mergeGeometries([blade(0), blade(Math.PI / 2)]);
}

function jellyGeometry(): THREE.BufferGeometry {
  const bell = new THREE.SphereGeometry(0.3, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  bell.deleteAttribute('uv');
  bell.deleteAttribute('normal');
  const parts: THREE.BufferGeometry[] = [bell.toNonIndexed()];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const g = new THREE.PlaneGeometry(0.03, 0.9, 1, 5).translate(0, -0.45, 0).rotateY(a + 0.5).translate(Math.cos(a) * 0.17, -0.01, Math.sin(a) * 0.17);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts);
}

function mantaGeometry(): THREE.BufferGeometry {
  // Yatay ızgara: x açıklık, z boy; kanatların arka kenarı geriye süpürülür, uçlara doğru incelir
  const g = new THREE.PlaneGeometry(1, 1, 12, 4).rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i);
    const v = p.getZ(i);
    p.setXYZ(i, u * 7, (0.5 - Math.abs(u)) * 0.5 * (0.5 - Math.abs(v)), (v + Math.abs(u) * 0.7) * 3.2 * (1 - Math.abs(u) * 1.2));
  }
  g.deleteAttribute('uv');
  const tail = new THREE.ConeGeometry(0.06, 3, 4).rotateX(Math.PI / 2).translate(0, 0, 2.6);
  tail.deleteAttribute('uv');
  return mergeGeometries([g, tail.toNonIndexed()].map((x) => (x.index ? x.toNonIndexed() : x)));
}

// ---------------------------------------------------------------- sahne

export interface SeaLife {
  update: (dt: number, time: number) => void;
  /** Tehdit sürerken sürüler tedirgin: dağınık ve hızlı. */
  setNervous: (on: boolean) => void;
  /** Geliştirme/test: sürülerin korkusu ve ortalama konumları. */
  debug: () => { fear: number[]; centroids: V3[] };
  /** Geliştirme/test: vatoz geçişini `wi` sıralı pencerenin önünde, yolun `k` (0..1) noktasından başlatır. */
  forceGlide: (wi: number, k: number) => void;
}

export function buildSeaLife(exterior: Exterior, L: WorldLayout): SeaLife {
  const outside = exterior.group;
  const windows = L.windows;
  const interiors = L.rooms.map((r) => expand(r.rect, WALL_OUT));
  const rocks = stationRocks(L);
  const dishes = dishSpots(L);
  const zones = clearZones(L);
  const wreck = L.entry?.wreck;
  // Enkazın üstünden geçerler (içinden değil)
  const floor = (x: number, z: number) => {
    const f = obstacleFloor(rocks, dishes, x, z, seabedHeight(x, z, distanceToRects(interiors, x, z)));
    return wreck && Math.hypot(x - wreck.x, z - wreck.z) < 4.2 ? Math.max(f, seabedHeight(wreck.x, wreck.z, distanceToRects(interiors, wreck.x, wreck.z)) + 3.6) : f;
  };
  const uTime = { value: 0 };
  const rng = createRng(123);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();

  // Balıklar: tek örnekli ağ; sürü başına renk tonu; kuyruk çırpması gölgelendiricide
  const sim = new FishSim(schoolPaths(windows, interiors), 26, { interiors, floor });
  const fishGeo = fishGeometry();
  const swimAttr = new THREE.InstancedBufferAttribute(sim.swim, 1);
  swimAttr.setUsage(THREE.DynamicDrawUsage);
  fishGeo.setAttribute('aSwim', swimAttr);
  const fishMat = withVertex(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.55, emissive: 0x15303a, side: THREE.DoubleSide }),
    'fish',
    {},
    'attribute float aSwim;',
    'transformed.x += sin(aSwim - position.z * 12.0) * 0.045 * smoothstep(0.12, -0.32, position.z);',
  );
  const fish = new THREE.InstancedMesh(fishGeo, fishMat, sim.n);
  fish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const tints = [0xb8d4d8, 0xd8c890, 0x8cb8e0, 0xc0d0b0, 0xe0b0a0, 0xa8c8c8];
  const sizes = new Float32Array(sim.n);
  for (let i = 0; i < sim.n; i++) {
    const c = new THREE.Color(tints[sim.school[i] % tints.length]).multiplyScalar(0.8 + rng() * 0.3);
    fish.setColorAt(i, c);
    sizes[i] = 0.75 + rng() * 0.6;
  }
  fish.frustumCulled = false;
  fish.name = 'sealife-fish';
  outside.add(fish);

  // Yosun: tabana kökü gömülü, salınım yükseklikle artar
  const kelpSpots = kelpLayout(windows, interiors, rocks, dishes, undefined, zones);
  const kelpGeo = kelpGeometry();
  kelpGeo.setAttribute('aSway', new THREE.InstancedBufferAttribute(Float32Array.from(kelpSpots, (k) => k.phase), 1));
  const kelpMat = withVertex(
    new THREE.MeshStandardMaterial({ color: 0x3f6a34, roughness: 0.9, emissive: 0x0d2414, side: THREE.DoubleSide }),
    'kelp',
    { uTime },
    'attribute float aSway;\nuniform float uTime;',
    `float kk = position.y * position.y;
    transformed.x += sin(uTime * 0.7 + aSway + position.y * 2.5) * 0.3 * kk;
    transformed.z += cos(uTime * 0.5 + aSway * 1.3 + position.y * 2.0) * 0.22 * kk;`,
  );
  const kelp = new THREE.InstancedMesh(kelpGeo, kelpMat, Math.max(1, kelpSpots.length));
  kelpSpots.forEach((k, i) => kelp.setMatrixAt(i, m4.compose(v.set(k.x, k.y, k.z), q.setFromEuler(e.set(0, k.phase, 0)), sc.set(0.8 + (k.phase % 1) * 0.6, k.scale, 1))));
  kelp.count = kelpSpots.length;
  kelp.computeBoundingSphere();
  kelp.name = 'sealife-kelp';
  outside.add(kelp);

  // Denizanaları: kendinden ışıklı (toplamsal), çan atımı ve dokunaç salınımı gölgelendiricide
  const jellySpots = jellyLayout(windows, interiors, rocks, dishes, undefined, undefined, zones);
  const jellyGeo = jellyGeometry();
  const jellyTints = [0x60e8ff, 0xb070ff, 0xff70c8, 0x70ffc0];
  jellyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(Float32Array.from(jellySpots, (j) => j.phase), 1));
  jellyGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(Float32Array.from(jellySpots.flatMap((_, i) => new THREE.Color(jellyTints[i % jellyTints.length]).toArray())), 3));
  const jellyMat = new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      attribute float aPhase; attribute vec3 aTint; uniform float uTime;
      varying vec3 vTint; varying float vGlow;
      void main(){
        vec3 p = position;
        float pulse = sin(uTime * 1.7 + aPhase);
        if (p.y >= 0.0) {
          p.xz *= 1.0 + 0.13 * pulse;
          p.y *= 1.0 - 0.12 * pulse;
          vGlow = 0.25 + 0.45 * (1.0 - p.y / 0.3);
        } else {
          float k = -p.y;
          p.x += sin(uTime * 1.3 + aPhase + k * 4.0) * 0.07 * k;
          p.z += cos(uTime * 1.1 + aPhase + k * 3.0) * 0.07 * k;
          vGlow = 0.35 * (1.0 - k);
        }
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vGlow *= exp(-length(w.xyz - cameraPosition) * 0.06) * (0.85 + 0.15 * pulse);
        vTint = aTint;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `varying vec3 vTint; varying float vGlow; void main(){ gl_FragColor = vec4(vTint * vGlow, 1.0); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const jellies = new THREE.InstancedMesh(jellyGeo, jellyMat, Math.max(1, jellySpots.length));
  jellies.count = jellySpots.length;
  jellies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  jellies.frustumCulled = false;
  jellies.name = 'sealife-jelly';
  outside.add(jellies);

  // Biyolüminesan plankton: sönük noktalar ara sıra parlar; yaratığın çevresinde hepsi uyanır
  const GLOW = 520;
  const gp = new Float32Array(GLOW * 3);
  const gph = new Float32Array(GLOW * 2);
  for (let i = 0; i < GLOW; i++) {
    const p = clearPoint(rng, windows, interiors, [], [], [1.5, 16], 0.4, 0) ?? [windows[0].x + windows[0].nx * 5, windows[0].z + windows[0].nz * 5];
    gp.set([p[0], -0.5 + rng() * 9, p[1]], i * 3);
    gph.set([rng() * 6.28, 0.3 + rng() * 0.9], i * 2);
  }
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  glowGeo.setAttribute('aPhase', new THREE.BufferAttribute(gph, 2));
  const uCreature = { value: new THREE.Vector4(0, -999, 0, 0) };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uCreature, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute vec2 aPhase; uniform float uTime; uniform vec4 uCreature; uniform float uScale;
      varying float vGlow;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.11 + aPhase.x) * 0.6;
        p.y += sin(uTime * 0.07 + aPhase.x * 2.0) * 0.4;
        p.z += cos(uTime * 0.09 + aPhase.x) * 0.6;
        float blink = pow(max(0.0, sin(uTime * aPhase.y + aPhase.x)), 14.0);
        float near = uCreature.w * smoothstep(11.0, 3.0, distance(p, uCreature.xyz));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vGlow = (0.08 + blink * 0.9 + near * (0.6 + 0.4 * sin(uTime * 9.0 + aPhase.x * 5.0))) * exp(-length(mv.xyz) * 0.07);
        gl_PointSize = clamp(uScale * (0.035 + 0.03 * blink + 0.03 * near) / -mv.z, 1.0, 12.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `varying float vGlow; void main(){
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(0.3, 0.95, 0.85) * vGlow * smoothstep(0.5, 0.0, d), 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  glow.name = 'sealife-plankton';
  outside.add(glow);

  // Uzaktan geçen vatoz silüeti: zararsız, yavaş kanat çırpar, istasyonun çatısının üstünden geçer
  const mantaMat = withVertex(
    new THREE.MeshBasicMaterial({ color: 0x06252c, side: THREE.DoubleSide }),
    'manta',
    { uTime },
    'uniform float uTime;',
    'transformed.y += sin(uTime * 1.1 - abs(position.x) * 0.35) * 0.09 * position.x * position.x * (position.z < 2.0 ? 1.0 : 0.0);',
  );
  const manta = new THREE.Mesh(mantaGeometry(), mantaMat);
  manta.visible = false;
  manta.name = 'sealife-manta';
  outside.add(manta);
  const glide = { active: false, start: 0, next: 12 + rng() * 20, duration: 75, base: [0, 0, 0] as V3, dir: [1, 0] as [number, number] };

  const setFish = () => {
    for (let i = 0; i < sim.n; i++) {
      const o = i * 3;
      const s = sizes[i];
      fish.setMatrixAt(i, m4.compose(v.set(sim.pos[o], sim.pos[o + 1], sim.pos[o + 2]), q.setFromEuler(e.set(sim.pitch[i], sim.yaw[i], 0, 'YXZ')), sc.set(s, s, s)));
    }
    fish.instanceMatrix.needsUpdate = true;
    swimAttr.needsUpdate = true;
  };
  setFish();
  const setJellies = (time: number) => {
    for (let i = 0; i < jellySpots.length; i++) {
      const j = jellySpots[i];
      // Yavaş sürüklenme, atımla hafif yükselme
      const y = j.y + Math.sin(time * 0.21 + j.phase) * 0.5 + Math.max(0, Math.sin(time * 1.7 + j.phase)) * 0.05;
      jellies.setMatrixAt(i, m4.compose(v.set(j.x + Math.sin(time * 0.05 + j.phase) * 1.2, y, j.z + Math.cos(time * 0.04 + j.phase * 1.7) * 1.2), q.setFromEuler(e.set(Math.sin(time * 0.3 + j.phase) * 0.15, 0, Math.cos(time * 0.27 + j.phase) * 0.15)), sc.setScalar(j.scale)));
    }
    jellies.instanceMatrix.needsUpdate = true;
  };
  setJellies(0);
  let now = 0;
  const startGlide = (time: number, wi: number, k: number) => {
    const w = windows[wi];
    const d = 21 + rng() * 5;
    Object.assign(glide, { active: true, start: time - k * glide.duration, base: [w.x + w.nx * d, 7.5 + rng() * 2.5, w.z + w.nz * d], dir: rng() < 0.5 ? [-w.nz, w.nx] : [w.nz, -w.nx] });
  };

  return {
    setNervous(on) {
      sim.nervous = on ? 1 : 0;
    },
    debug: () => ({ fear: [...sim.fear], centroids: sim.paths.map((_, s) => sim.centroid(s)) }),
    forceGlide: (wi, k) => startGlide(now, wi, k),
    update(dt, time) {
      uTime.value = time;
      const c = exterior.creature();
      uCreature.value.set(c?.x ?? 0, c?.y ?? -999, c?.z ?? 0, c ? 1 : 0);
      now = time;
      if (!glide.active && time > glide.next) startGlide(time, Math.floor(rng() * windows.length), 0);
      if (glide.active) {
        const k = (time - glide.start) / glide.duration;
        if (k >= 1) Object.assign(glide, { active: false, next: time + 40 + rng() * 50 });
        manta.visible = glide.active;
        const along = (k - 0.5) * 80;
        manta.position.set(glide.base[0] + glide.dir[0] * along, glide.base[1] + Math.sin(time * 0.3) * 0.5, glide.base[2] + glide.dir[1] * along);
        // Model burnu −z'de: hareket yönüne döner
        manta.rotation.set(0, Math.atan2(-glide.dir[0], -glide.dir[1]), Math.sin(time * 0.25) * 0.08);
      }
      if (!exterior.visible) return;
      sim.step(dt, time, c);
      setFish();
      setJellies(time);
    },
  };
}
