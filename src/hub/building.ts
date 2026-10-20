// Bina: dünya yerleşimindeki bütün odaları (koridor ve gerçek odalar) Quaternius modülleriyle
// (instancing) kurar; zeminlere Poly Haven metal plaka dokusu. Çarpışma için XZ düzleminde kutular döner.

import * as THREE from 'three';
import { CEILING, WALL_INNER, type Rect, type WorldLayout } from '../world/layout';
import { instanceAll, pbrMaterial, type Assets } from './assets';

export interface Building {
  colliders: THREE.Box3[];
  /** 1 = normal aydınlatma, 0 = enerji kesik (acil durum loşluğu kalır). */
  setPower: (level: number) => void;
}

export function buildBuilding(scene: THREE.Scene, assets: Assets, L: WorldLayout): Building {
  // Sabit modüller. Tavan gölge düşürmez: üstteki tek gölgeli ışığı kapatmasın.
  const statics = instanceAll(assets.models, L.placements);
  // Lomboz camı şeffaf: dışarıdaki su altı sahnesi (hub/exterior.ts) görünür; çok hafif bir yansıma tonu.
  const oceanGlass = new THREE.MeshBasicMaterial({ color: 0xc8f2ff, transparent: true, opacity: 0.06, depthWrite: false, fog: false });
  statics.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    if (o.name.startsWith('Platform_DarkPlates')) o.castShadow = false;
    if ((o.material as THREE.Material).name === 'M_Glass') {
      o.material = oceanGlass;
      o.castShadow = false;
    }
  });
  scene.add(statics);

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

  // Zeminler (oda başına) ve koridorlarda kılavuz şeritleri
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x0a3a3a, emissive: 0x18c0c0, emissiveIntensity: 1 });
  for (const { def, rect: r } of L.rooms) {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pbrMaterial(assets.metalPlate, new THREE.Vector2(w / 2, d / 2), { metalness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
    floor.receiveShadow = true;
    scene.add(floor);
    if (def.type === 'corridor') {
      const cx = (r.minX + r.maxX) / 2;
      for (const x of [cx - (WALL_INNER - 0.12), cx + (WALL_INNER - 0.12)]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, d - 1.2), stripMat);
        s.position.set(x, 0.008, (r.minZ + r.maxZ) / 2);
        scene.add(s);
      }
    }
  }

  // Lamba armatürlerinin altındaki parlak yüzey (modellerde emissive doku yok)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0xa8e8ff, emissiveIntensity: 1.2 });
  const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.02, 0.22), lampMat, L.lampFixtures.length);
  const m = new THREE.Matrix4();
  L.lampFixtures.forEach((p, k) => glow.setMatrixAt(k, m.makeTranslation(p.x, CEILING - 0.135, p.z)));
  glow.instanceMatrix.needsUpdate = true;
  scene.add(glow);

  // Az sayıda gerçek ışık (gölgesiz)
  const lamps = L.lampLights.map((p) => {
    const l = new THREE.PointLight(0x9fe0f0, 22, 12, 1.4);
    l.position.set(p.x, p.y, p.z);
    scene.add(l);
    return l;
  });

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

  const base = { lamp: lamps[0]?.intensity ?? 0, hemi: hemi.intensity, sun: sun.intensity, strip: 1, lampEm: lampMat.emissiveIntensity };
  const setPower = (level: number) => {
    lamps.forEach((l) => (l.intensity = base.lamp * level));
    hemi.intensity = base.hemi * (0.12 + 0.88 * level);
    sun.intensity = base.sun * level;
    stripMat.emissiveIntensity = base.strip * (0.25 + 0.75 * level);
    lampMat.emissiveIntensity = base.lampEm * level;
  };

  return { colliders: L.colliders.map(toBox), setPower };
}

export function toBox(r: Rect): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(r.minX, r.minY ?? -1, r.minZ), new THREE.Vector3(r.maxX, r.maxY ?? 6, r.maxZ));
}
