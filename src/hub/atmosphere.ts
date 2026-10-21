// Atmosfer: oda giydirmesinin görsel süsleri. Kir/pas izleri ve tabelalar atlaslı instanced düzlemler (birkaç
// çizim çağrısı), ekranlar türe göre paylaşılan animasyonlu tuvaller, buhar/gaz/damla parçacıkları (yalnız
// kameraya yakın kaynaklar güncellenir). Gölge düşürmez; ışık bütçesine dokunmaz.

import * as THREE from 'three';
import type { Emitter, EmitterKind, ScreenKind } from '../world/dressing';
import type { WorldLayout } from '../world/layout';
import { GRIME_ROWS, grimeAtlas, ScreenCanvas, signAtlas, softDot } from './procedural';

export interface Atmosphere {
  update: (dt: number, elapsed: number, camera: THREE.Camera) => void;
  /** Kameraya en yakın kaynak mesafesi (ses için), türe göre. */
  nearest: (kind: EmitterKind, from: THREE.Vector3) => number;
  /** Güç seviyesi (0..1): ekranlar kararır. */
  setPower: (level: number) => void;
  /** Buhar kaynaklarından biri püskürdü mü (bu kare); ses için konumu döner. */
  takeBursts: () => THREE.Vector3[];
}

/** Atlas karosunu örneğe göre seçen materyal yaması (uv = uv·ölçek + aTile). */
function tiled<M extends THREE.Material>(mat: M, scale: [number, number]): M {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTile;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * vec2(${scale[0].toFixed(6)}, ${scale[1].toFixed(6)}) + aTile;\n#endif`);
  };
  mat.customProgramCacheKey = () => `tiled-${scale[0]}-${scale[1]}`;
  return mat;
}

function instancedQuads(count: number, mat: THREE.Material, place: (k: number, m: THREE.Matrix4) => [number, number]): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  const tile = new Float32Array(count * 2);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const [u, v] = place(k, m);
    mesh.setMatrixAt(k, m);
    tile[k * 2] = u;
    tile[k * 2 + 1] = v;
  }
  geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tile, 2));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

interface Particle {
  alive: number;
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
}

const KIND_SPEC: Record<EmitterKind, { max: number; rate: number; life: [number, number]; size: number; color: number; opacity: number }> = {
  steam: { max: 60, rate: 14, life: [1.4, 2.4], size: 0.55, color: 0xcfe6ea, opacity: 0.22 },
  gas: { max: 50, rate: 24, life: [0.5, 0.9], size: 0.28, color: 0xbfe0d0, opacity: 0.18 },
  drip: { max: 12, rate: 1.4, life: [1.2, 1.2], size: 0.05, color: 0x9fd8e8, opacity: 0.85 },
};

export function buildAtmosphere(scene: THREE.Scene, L: WorldLayout): Atmosphere {
  const decor = L.decor;
  const grime = decor.flatMap((d) => d.grime);
  const wallGrime = grime.filter((g) => !g.floor);
  const floorGrime = grime.filter((g) => g.floor);
  const atlas = grimeAtlas();

  // --- Kir, pas, damlama izleri (duvar) ve su birikintileri (zemin)
  const grimeMat = tiled(new THREE.MeshStandardMaterial({ map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.9, metalness: 0.2 }), [0.25, 0.25]);
  if (wallGrime.length) {
    scene.add(
      instancedQuads(wallGrime.length, grimeMat, (k, m) => {
        const g = wallGrime[k];
        m.compose(tmpV.set(g.x, g.y, g.z), tmpQ.setFromEuler(tmpE.set(0, g.rotY, 0)), tmpS.set(g.w, g.h, 1));
        // Atlas: satır = tür (yukarıdan), sütun = varyant; canvas y aşağı, uv y yukarı
        return [g.variant * 0.25, 1 - (GRIME_ROWS[g.kind] + 1) * 0.25];
      }),
    );
  }
  const puddleMat = tiled(new THREE.MeshStandardMaterial({ map: atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.08, metalness: 0.6, color: 0x9ab8c0 }), [0.25, 0.25]);
  if (floorGrime.length) {
    scene.add(
      instancedQuads(floorGrime.length, puddleMat, (k, m) => {
        const g = floorGrime[k];
        m.compose(tmpV.set(g.x, g.y, g.z), tmpQ.setFromEuler(tmpE.set(-Math.PI / 2, g.rotY, 0, 'YXZ')), tmpS.set(g.w, g.h, 1));
        return [g.variant * 0.25, 1 - (GRIME_ROWS.water + 1) * 0.25];
      }),
    );
  }

  // --- Tabelalar (tek atlas); hafif öz ışıma ki karanlıkta da okunur
  const signs = decor.flatMap((d) => d.signs);
  const sa = signAtlas(signs);
  const signMat = tiled(new THREE.MeshStandardMaterial({ map: sa.texture, emissiveMap: sa.texture, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }), [1 / sa.cols, 1 / sa.rows]);
  if (signs.length) {
    scene.add(
      instancedQuads(signs.length, signMat, (k, m) => {
        const s = signs[k];
        m.compose(tmpV.set(s.x, s.y, s.z), tmpQ.setFromEuler(tmpE.set(0, s.rotY, 0)), tmpS.set(s.w, s.h, 1));
        return [(k % sa.cols) / sa.cols, 1 - (Math.floor(k / sa.cols) + 1) / sa.rows];
      }),
    );
  }

  // --- Ekranlar: tür başına bir tuval ve bir instanced düzlem; arkada koyu çerçeve
  const screens = decor.flatMap((d) => d.screens);
  const canvases = new Map<ScreenKind, ScreenCanvas>();
  const screenMats: THREE.MeshBasicMaterial[] = [];
  for (const kind of [...new Set(screens.map((s) => s.kind))]) {
    const list = screens.filter((s) => s.kind === kind);
    const sc = new ScreenCanvas(kind);
    canvases.set(kind, sc);
    const mat = new THREE.MeshBasicMaterial({ map: sc.texture, toneMapped: false, color: 0xc8c8c8 });
    screenMats.push(mat);
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, list.length);
    list.forEach((s, k) => mesh.setMatrixAt(k, new THREE.Matrix4().compose(tmpV.set(s.x, s.y, s.z), tmpQ.setFromEuler(tmpE.set(0, s.rotY, 0)), tmpS.set(s.w, s.h, 1))));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  if (screens.length) {
    const frame = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x10181c, roughness: 0.5, metalness: 0.6 }), screens.length);
    screens.forEach((s, k) => {
      // Ekranın 2 cm arkasında, kenarlardan 4 cm taşan kutu
      const back = tmpV.set(Math.sin(s.rotY), 0, Math.cos(s.rotY)).multiplyScalar(-0.025);
      frame.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(s.x + back.x, s.y, s.z + back.z), tmpQ.setFromEuler(tmpE.set(0, s.rotY, 0)), tmpS.set(s.w + 0.08, s.h + 0.08, 0.04)));
    });
    frame.instanceMatrix.needsUpdate = true;
    frame.computeBoundingSphere();
    scene.add(frame);
  }

  // --- Parçacıklar: tür başına tek Points; havuz, yalnız yakın kaynaklar üretir
  const emitters = decor.flatMap((d) => d.emitters);
  const dot = softDot();
  const systems = (Object.keys(KIND_SPEC) as EmitterKind[]).map((kind) => {
    const spec = KIND_SPEC[kind];
    const list = emitters.filter((e) => e.kind === kind);
    const n = spec.max * Math.max(1, Math.min(list.length, 4));
    const pos = new Float32Array(n * 3).fill(-999);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: dot, color: spec.color, size: spec.size, transparent: true, opacity: spec.opacity, depthWrite: false, sizeAttenuation: true });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    const parts: Particle[] = Array.from({ length: n }, () => ({ alive: 0, life: 1, p: new THREE.Vector3(0, -999, 0), v: new THREE.Vector3() }));
    // Buhar düzensiz püskürür: her kaynağın kendi açık/kapalı zamanlaması
    const phase = list.map((_, k) => ({ on: 0, next: 1 + k * 1.7 }));
    return { kind, spec, list, parts, pos, geo, phase, acc: 0 };
  });
  const bursts: THREE.Vector3[] = [];
  let screenClock = 0;
  let power = 1;

  const spawn = (sys: (typeof systems)[number], e: Emitter) => {
    const part = sys.parts.find((p) => p.alive <= 0);
    if (!part) return;
    const { spec } = sys;
    part.life = spec.life[0] + Math.random() * (spec.life[1] - spec.life[0]);
    part.alive = part.life;
    part.p.set(e.x, e.y, e.z);
    if (sys.kind === 'drip') part.v.set(0, 0, 0);
    else {
      const speed = sys.kind === 'gas' ? 2.6 : 0.7;
      part.v.set(e.dx * speed + (Math.random() - 0.5) * 0.25, e.dy * speed + Math.random() * 0.2, e.dz * speed + (Math.random() - 0.5) * 0.25);
    }
  };

  return {
    update(dt, elapsed, camera) {
      // Ekranlar: saniyede 6 kez yeniden çizilir
      screenClock += dt;
      if (screenClock > 1 / 6) {
        screenClock = 0;
        for (const c of canvases.values()) c.draw(elapsed);
      }
      const cam = camera.position;
      for (const sys of systems) {
        sys.list.forEach((e, k) => {
          if (Math.hypot(e.x - cam.x, e.z - cam.z) > 18) return;
          if (sys.kind === 'steam') {
            const ph = sys.phase[k];
            ph.next -= dt;
            if (ph.next <= 0) {
              if (ph.on > 0) {
                ph.on = 0;
                ph.next = 3 + Math.random() * 6;
              } else {
                ph.on = 1;
                ph.next = 1.2 + Math.random() * 1.2;
                bursts.push(new THREE.Vector3(e.x, e.y, e.z));
              }
            }
            if (!ph.on) return;
          }
          sys.acc += dt * sys.spec.rate;
          while (sys.acc >= 1) {
            sys.acc -= 1;
            spawn(sys, e);
          }
        });
        sys.parts.forEach((p, k) => {
          if (p.alive > 0) {
            p.alive -= dt;
            if (sys.kind === 'drip') {
              p.v.y -= 9.8 * dt;
              if (p.p.y <= 0.02) p.alive = 0;
            } else {
              p.v.multiplyScalar(1 - dt * 0.8);
              p.v.y += dt * (sys.kind === 'steam' ? 0.35 : 0.1);
            }
            p.p.addScaledVector(p.v, dt);
          }
          const live = p.alive > 0;
          sys.pos[k * 3] = live ? p.p.x : 0;
          sys.pos[k * 3 + 1] = live ? p.p.y : -999;
          sys.pos[k * 3 + 2] = live ? p.p.z : 0;
        });
        sys.geo.attributes.position.needsUpdate = true;
      }
    },
    nearest(kind, from) {
      let best = Infinity;
      for (const e of emitters) if (e.kind === kind) best = Math.min(best, Math.hypot(e.x - from.x, e.y - from.y, e.z - from.z));
      return best;
    },
    setPower(level) {
      power = level;
      for (const m of screenMats) m.color.setScalar(0.08 + 0.7 * power);
      signMat.emissiveIntensity = 0.1 + 0.25 * power;
    },
    takeBursts() {
      return bursts.splice(0, bursts.length);
    },
  };
}
