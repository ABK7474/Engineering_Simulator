// Low-poly su altı koridoru, primitiflerden. Çarpışma için XZ düzleminde kutular döner.

import * as THREE from 'three';

export const LAYOUT = {
  halfWidth: 2,
  height: 3,
  zStart: 6,
  doorZ: -14,
  zEnd: -20,
  doorHalfWidth: 0.8,
  doorHeight: 2.3,
} as const;

export interface Corridor {
  colliders: THREE.Box3[];
  /** 1 = normal aydınlatma, 0 = enerji kesik (acil durum loşluğu kalır). */
  setPower: (level: number) => void;
}

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, metalness: 0.3, ...extra });

const M = {
  wall: mat(0x4a6068),
  floor: mat(0x1d2528, { roughness: 0.6, metalness: 0.6 }),
  ceiling: mat(0x26333a),
  rib: mat(0x55666c, { metalness: 0.6 }),
  pipe: mat(0x7a6440, { metalness: 0.7, roughness: 0.5 }),
  hazard: mat(0xd4a017, { emissive: 0x3a2a00 }),
};

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  pos: [number, number, number],
  material: THREE.Material,
  shadow: { cast?: boolean; receive?: boolean } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  m.position.set(...pos);
  m.castShadow = shadow.cast ?? false;
  m.receiveShadow = shadow.receive ?? true;
  parent.add(m);
  return m;
}

/** XZ düzleminde çarpışma kutusu (y ekseni yok sayılır). */
function xz(x0: number, x1: number, z0: number, z1: number): THREE.Box3 {
  return new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), -1, Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), 5, Math.max(z0, z1)));
}

export function buildCorridor(scene: THREE.Scene): Corridor {
  const { halfWidth: hw, height: h, zStart, doorZ, zEnd, doorHalfWidth: dw, doorHeight: dh } = LAYOUT;
  const len = zStart - zEnd;
  const zMid = (zStart + zEnd) / 2;
  const g = new THREE.Group();
  scene.add(g);

  // Kabuk
  box(g, [hw * 2, 0.1, len], [0, -0.05, zMid], M.floor);
  box(g, [hw * 2, 0.1, len], [0, h + 0.05, zMid], M.ceiling, { receive: false });
  box(g, [0.2, h, len], [-hw - 0.1, h / 2, zMid], M.wall);
  box(g, [0.2, h, len], [hw + 0.1, h / 2, zMid], M.wall);
  box(g, [hw * 2, h, 0.2], [0, h / 2, zStart + 0.1], M.wall);
  box(g, [hw * 2, h, 0.2], [0, h / 2, zEnd - 0.1], M.wall);

  // Kapı duvarı: iki yan parça + üst lento
  const sideW = hw - dw;
  box(g, [sideW, h, 0.3], [-(dw + sideW / 2), h / 2, doorZ], M.wall);
  box(g, [sideW, h, 0.3], [dw + sideW / 2, h / 2, doorZ], M.wall);
  box(g, [dw * 2, h - dh, 0.3], [0, dh + (h - dh) / 2, doorZ], M.wall);
  box(g, [dw * 2 + 0.2, 0.08, 0.32], [0, dh + 0.04, doorZ], M.hazard);

  // Kaburgalar (gölge düşüren sabit detaylar)
  for (let z = zStart - 1.5; z > zEnd; z -= 3) {
    if (Math.abs(z - doorZ) < 1) continue;
    box(g, [0.15, h, 0.25], [-hw + 0.075, h / 2, z], M.rib, { cast: true });
    box(g, [0.15, h, 0.25], [hw - 0.075, h / 2, z], M.rib, { cast: true });
    box(g, [hw * 2, 0.15, 0.25], [0, h - 0.075, z], M.rib, { cast: true });
  }

  // Tavan boruları
  const pipeGeo = new THREE.CylinderGeometry(0.07, 0.07, len, 8);
  pipeGeo.rotateX(Math.PI / 2);
  for (const x of [-1.45, -1.25, 1.4]) {
    const p = new THREE.Mesh(pipeGeo, M.pipe);
    p.position.set(x, h - 0.3, zMid);
    p.castShadow = true;
    g.add(p);
  }

  // Lombozlar: dışarıdaki okyanus
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x0f6f7f, fog: false });
  const ringMat = mat(0x6d7c80, { metalness: 0.8 });
  for (const z of [2, -4, -10, -17]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.07, 6, 12), ringMat);
    ring.position.set(-hw + 0.02, 1.7, z);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.36, 12), glassMat);
    glass.position.set(-hw + 0.01, 1.7, z);
    glass.rotation.y = Math.PI / 2;
    g.add(glass);
  }

  // Zemin kılavuz şeritleri ve tavan lambaları (güç kesilince söner)
  const stripMat = new THREE.MeshStandardMaterial({ color: 0x0a3a3a, emissive: 0x18c0c0, emissiveIntensity: 1 });
  for (const x of [-hw + 0.25, hw - 0.25]) box(g, [0.05, 0.02, len - 0.4], [x, 0.01, zMid], stripMat);

  const lampMat = new THREE.MeshStandardMaterial({ color: 0x223, emissive: 0xbfe8ff, emissiveIntensity: 1.2 });
  const lamps: THREE.PointLight[] = [];
  for (const z of [3, -3, -9, -17]) {
    box(g, [0.6, 0.05, 0.3], [0, h - 0.03, z], lampMat, { receive: false });
    const l = new THREE.PointLight(0xa8dcff, 22, 10, 1.4);
    l.position.set(0, h - 0.25, z);
    g.add(l);
    lamps.push(l);
  }

  const hemi = new THREE.HemisphereLight(0x6fbfd0, 0x10262c, 2.2);
  scene.add(hemi);

  // Tek gölgeli ışık: yukarıdan, sabit gölge haritası için.
  const sun = new THREE.DirectionalLight(0x9fd8e8, 1.6);
  sun.position.set(0.8, 12, zMid + 1);
  sun.target.position.set(0, 0, zMid);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: len / 2 + 1, bottom: -len / 2 - 1, near: 1, far: 20 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const base = { lamp: lamps[0].intensity, hemi: hemi.intensity, sun: sun.intensity, strip: 1, lampEm: 1.2 };
  const setPower = (level: number) => {
    lamps.forEach((l) => (l.intensity = base.lamp * level));
    hemi.intensity = base.hemi * (0.15 + 0.85 * level);
    sun.intensity = base.sun * level;
    stripMat.emissiveIntensity = base.strip * (0.25 + 0.75 * level);
    lampMat.emissiveIntensity = base.lampEm * level;
  };

  const colliders = [
    xz(-hw - 0.5, -hw, zEnd - 0.5, zStart + 0.5),
    xz(hw, hw + 0.5, zEnd - 0.5, zStart + 0.5),
    xz(-hw, hw, zStart, zStart + 0.5),
    xz(-hw, hw, zEnd - 0.5, zEnd),
    xz(-hw, -dw, doorZ - 0.15, doorZ + 0.15),
    xz(dw, hw, doorZ - 0.15, doorZ + 0.15),
  ];

  return { colliders, setPower };
}
