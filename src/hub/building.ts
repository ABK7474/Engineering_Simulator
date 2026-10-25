// Bina: dünya yerleşimindeki bütün odaları (koridor ve gerçek odalar) Quaternius modülleriyle (instancing)
// kurar; zeminlere Poly Haven metal plaka dokusu. Statik modeller oda başına gruplanır: görünmeyen odalar
// gizlenir, bakış dışında kalanları çerçeve elemesi atar. Işıklar sabit sayılı bir havuzdur (shader yeniden
// derlenmesin): soğuk lambalar kameraya en yakın lamba noktalarına, sıcak vurgular ekranlara dağıtılır.

import * as THREE from 'three';
import { CEILING, WALL_INNER, type Rect, type WorldLayout } from '../world/layout';
import { batchAll, pbrMaterial, type Assets } from './assets';

export interface Building {
  colliders: THREE.Box3[];
  /** 1 = normal aydınlatma, 0 = enerji kesik (acil durum loşluğu kalır). */
  setPower: (level: number) => void;
  /** Işık havuzu ve titreyen lambalar; her kare. */
  update: (dt: number, elapsed: number, camera: THREE.Camera) => void;
  /** Yalnız bu odaların statik modelleri çizilir. */
  setVisibleRooms: (rooms: ReadonlySet<string>) => void;
  /** Oda başına statik model grupları (görünürlüğü setVisibleRooms yönetir). */
  roomGroups: THREE.Object3D[];
}

/** Havuzdaki soğuk (lamba) ve sıcak (ekran) ışık sayısı. */
export const COLD_LIGHTS = 6;
export const WARM_LIGHTS = 2;
const COLD = { color: 0x9fe0f0, intensity: 22, distance: 12, decay: 1.4 };
const WARM = { color: 0xff8a3a, intensity: 4, distance: 5, decay: 1.6 };

/** Titreme deseni: çoğu zaman tam parlak, ara sıra kısa, düzensiz sönme patlamaları. */
export function flickerLevel(t: number, k: number): number {
  const window = (t * 0.23 + k * 0.618) % 1;
  if (window > 0.1) return 1;
  const s = Math.sin(t * 61 + k * 13) * Math.sin(t * 23 + k * 5);
  return s > 0.2 ? 0.15 : 0.55 + 0.45 * Math.abs(s);
}

interface PoolLight {
  light: THREE.PointLight;
  target: number;
  fade: number;
}

export function buildBuilding(scene: THREE.Scene, assets: Assets, L: WorldLayout): Building {
  // Sabit modeller oda başına. Tavan gölge düşürmez: üstteki tek gölgeli ışığı kapatmasın.
  const byRoom = new Map<string, THREE.Group>();
  const roomKeys = [...new Set(L.placements.map((p) => p.room ?? ''))];
  // Lomboz camı şeffaf: dışarıdaki su altı sahnesi (hub/exterior.ts) görünür; çok hafif bir yansıma tonu.
  const oceanGlass = new THREE.MeshBasicMaterial({ color: 0xc8f2ff, transparent: true, opacity: 0.06, depthWrite: false, fog: false });
  for (const key of roomKeys) {
    const g = batchAll(assets.models, L.placements.filter((p) => (p.room ?? '') === key), {
      // Okyanus camı yalnız pencere modüllerinde; düz duvarın dekoratif cam şeridi saydamlaşırsa arkasındaki boşluk görünür
      material: (m, id) => (m.name === 'M_Glass' && id.includes('Window') ? oceanGlass : m),
      castShadow: (id, m) => !id.startsWith('Platform_DarkPlates') && m !== oceanGlass,
    });
    g.name = key ? `room:${key}` : 'shared';
    scene.add(g);
    if (key) byRoom.set(key, g);
  }

  // Köşe dolguları: duvar parçalarının köşede bıraktığı aralıktan dışarısı görünmesin.
  if (L.cornerFills.length) {
    const fill = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1a2327, roughness: 0.8, metalness: 0.5 }), L.cornerFills.length);
    const m = new THREE.Matrix4();
    L.cornerFills.forEach((f, k) => {
      const [w, d] = [f.maxX - f.minX, f.maxZ - f.minZ];
      fill.setMatrixAt(k, m.makeScale(w, CEILING, d).setPosition((f.minX + f.maxX) / 2, CEILING / 2, (f.minZ + f.maxZ) / 2));
    });
    fill.castShadow = true;
    scene.add(fill);
  }

  // Zeminler (oda başına, odanın grubunda) ve koridorlarda kılavuz şeritleri
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x0a3a3a, emissive: 0x18c0c0, emissiveIntensity: 1 });
  for (const { def, rect: r } of L.rooms) {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const parent = byRoom.get(def.id) ?? scene;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pbrMaterial(assets.metalPlate, new THREE.Vector2(w / 2, d / 2), { metalness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
    floor.receiveShadow = true;
    parent.add(floor);
    if (def.type === 'corridor') {
      const cx = (r.minX + r.maxX) / 2;
      for (const x of [cx - (WALL_INNER - 0.12), cx + (WALL_INNER - 0.12)]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, d - 1.2), stripMat);
        s.position.set(x, 0.008, (r.minZ + r.maxZ) / 2);
        parent.add(s);
      }
    }
  }

  // Lamba armatürlerinin altındaki parlak yüzey (aydınlanmaz; titreyenler örnek rengiyle kısılır)
  const lampColor = new THREE.Color(0xa8e8ff);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
  const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.02, 0.22), lampMat, L.lampFixtures.length);
  const m = new THREE.Matrix4();
  L.lampFixtures.forEach((p, k) => {
    glow.setMatrixAt(k, m.makeTranslation(p.x, CEILING - 0.135, p.z));
    glow.setColorAt(k, lampColor);
  });
  glow.instanceMatrix.needsUpdate = true;
  scene.add(glow);
  const flicker = new Set(L.flicker);

  // Işık havuzu (gölgesiz)
  const pool = (n: number, spec: typeof COLD): PoolLight[] =>
    Array.from({ length: n }, () => {
      const light = new THREE.PointLight(spec.color, 0, spec.distance, spec.decay);
      light.position.set(0, -50, 0);
      scene.add(light);
      return { light, target: -1, fade: 0 };
    });
  const cold = pool(COLD_LIGHTS, COLD);
  const warm = pool(WARM_LIGHTS, WARM);
  const lampSpots = L.lampLights.map((p) => ({ p: new THREE.Vector3(p.x, p.y, p.z), room: p.room }));
  // Her lamba ışığına en yakın armatür (titreme onu izler)
  const nearestFixture = L.lampLights.map((p) => {
    let best = 0;
    L.lampFixtures.forEach((f, k) => {
      if (Math.hypot(f.x - p.x, f.z - p.z) < Math.hypot(L.lampFixtures[best].x - p.x, L.lampFixtures[best].z - p.z)) best = k;
    });
    return best;
  });
  const accentSpots = L.decor.flatMap((d) => d.accents.map((a) => ({ p: new THREE.Vector3(a.x, a.y, a.z), room: d.room })));

  const hemi = new THREE.HemisphereLight(0x3f9fb0, 0x061a20, 0.7);
  scene.add(hemi);

  // Tek gölgeli ışık: yukarıdan, sabit gölge haritası için; bütün dünyayı kapsar.
  const b = L.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const sun = new THREE.DirectionalLight(0x7fc8d8, 0.6);
  sun.position.set(cx + 0.8, 14, cz + 1);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const hw = (b.maxX - b.minX) / 2 + 1;
  const hd = (b.maxZ - b.minZ) / 2 + 1;
  Object.assign(sun.shadow.camera, { left: -hw, right: hw, top: hd, bottom: -hd, near: 1, far: 20 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  let power = 1;
  let visible: ReadonlySet<string> = new Set(L.rooms.map((r) => r.def.id));
  const base = { hemi: hemi.intensity, sun: sun.intensity, strip: 1 };
  const setPower = (level: number) => {
    power = level;
    hemi.intensity = base.hemi * (0.12 + 0.88 * level);
    sun.intensity = base.sun * level;
    stripMat.emissiveIntensity = base.strip * (0.25 + 0.75 * level);
  };

  /** Havuzu en yakın hedeflere dağıt: hedefi değişen ışık sönükten başlar (ani parlama yok). */
  const assign = (lights: PoolLight[], spots: { p: THREE.Vector3; room: string }[], cam: THREE.Vector3) => {
    const want = spots
      .map((s, k) => ({ k, d: s.p.distanceToSquared(cam), ok: visible.has(s.room) }))
      .filter((x) => x.ok)
      .sort((a, b2) => a.d - b2.d)
      .slice(0, lights.length)
      .map((x) => x.k);
    const free = lights.filter((l) => !want.includes(l.target));
    const taken = new Set(lights.map((l) => l.target));
    for (const k of want) {
      if (taken.has(k)) continue;
      const l = free.shift();
      if (!l) break;
      l.target = k;
      l.fade = 0;
      l.light.position.copy(spots[k].p);
    }
    for (const l of free) l.target = -1;
  };
  let assignClock = 1;

  return {
    colliders: L.colliders.map(toBox),
    roomGroups: [...byRoom.values()],
    setPower,
    setVisibleRooms(rooms) {
      visible = rooms;
      for (const [id, g] of byRoom) g.visible = rooms.has(id);
      assignClock = 1;
    },
    update(dt, elapsed, camera) {
      assignClock += dt;
      if (assignClock > 0.4) {
        assignClock = 0;
        assign(cold, lampSpots, camera.position);
        assign(warm, accentSpots, camera.position);
      }
      // Titreyen armatürler
      for (const k of flicker) glow.setColorAt(k, lampColor.clone().multiplyScalar(flickerLevel(elapsed, k) * (0.15 + 0.85 * power)));
      if (flicker.size || glow.userData.power !== power) {
        if (glow.userData.power !== power) L.lampFixtures.forEach((_, k) => !flicker.has(k) && glow.setColorAt(k, lampColor.clone().multiplyScalar(0.15 + 0.85 * power)));
        glow.userData.power = power;
        glow.instanceColor!.needsUpdate = true;
      }
      for (const l of cold) {
        l.fade = l.target < 0 ? Math.max(0, l.fade - dt * 3) : Math.min(1, l.fade + dt * 2.5);
        const f = l.target < 0 ? 1 : flicker.has(nearestFixture[l.target]) ? flickerLevel(elapsed, nearestFixture[l.target]) : 1;
        l.light.intensity = COLD.intensity * power * l.fade * f;
      }
      for (const l of warm) {
        l.fade = l.target < 0 ? Math.max(0, l.fade - dt * 3) : Math.min(1, l.fade + dt * 2.5);
        l.light.intensity = WARM.intensity * (0.3 + 0.7 * power) * l.fade * (0.92 + 0.08 * Math.sin(elapsed * 9 + l.target));
      }
    },
  };
}

export function toBox(r: Rect): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(r.minX, r.minY ?? -1, r.minZ), new THREE.Vector3(r.maxX, r.maxY ?? 6, r.maxZ));
}
