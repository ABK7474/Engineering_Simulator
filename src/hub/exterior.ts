// İstasyonun dışı (yalnız pencerelerden görünür): dikey renk geçişli su, yöne bağlı su sisi,
// prosedürel deniz tabanı ve kayalar, deniz karı, kabarcıklar, ışık huzmeleri, pencere önündeki
// zeminde dalgalı ışık deseni ve nadiren geçen büyük bir gölge. Hiç asset indirilmez.
// Kurallar: dış nesneler gölge düşürmez/almaz; ek dinamik ışık yok. Dış grup yalnız bir pencere
// kameranın görüş alanındayken çizilir (duvarların arkasına boşuna çizim yapılmaz).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/rng';
import { MODULE, WALL_INNER, type CorridorLayout } from './layout';

/** Dış sahnenin başladığı x (sol duvar modülünün dış yüzü −2,77'de). */
export const OUTSIDE_X = -2.9;
const WATER_TOP = new THREE.Color(0x3fb8c4);
const WATER_BOTTOM = new THREE.Color(0x020f17);
const WATER_DENSITY = 0.045;

// ---------------------------------------------------------------- saf yardımcılar (testli)

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Değer gürültüsü, 0..1. */
function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Deniz tabanı yüksekliği: istasyondan uzaklaştıkça iner; koridor zemininin (y = 0) hep altında. */
export function seabedHeight(x: number, z: number): number {
  const away = Math.max(0, -x - 3);
  const y = -1.0 - away * 0.06 + (valueNoise(x * 0.11, z * 0.11) - 0.5) * 1.6 + (valueNoise(x * 0.37 + 7, z * 0.37 - 3) - 0.5) * 0.5;
  return Math.min(y, -0.6);
}

export interface RockSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  squash: number;
}

/** Kaya yerleşimi (deterministik): hepsi dışarıda, deniz tabanına oturuyor. */
export function rockLayout(count = 28, seed = 4242): RockSpot[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => {
    const x = -6 - rng() * 30;
    const z = -42 + rng() * 56;
    const scale = 0.6 + rng() ** 2 * 3.2;
    return { x, z, y: seabedHeight(x, z) + scale * 0.25, scale, rotY: rng() * Math.PI * 2, squash: 0.45 + rng() * 0.4 };
  });
}

// ---------------------------------------------------------------- su rengi ve sis

const WATER_GLSL = /* glsl */ `
uniform vec3 uWaterTop;
uniform vec3 uWaterBottom;
vec3 waterColor(vec3 dir) {
  return mix(uWaterBottom, uWaterTop, smoothstep(-0.45, 0.65, dir.y));
}`;

const waterUniforms = () => ({
  uWaterTop: { value: WATER_TOP },
  uWaterBottom: { value: WATER_BOTTOM },
  uWaterDensity: { value: WATER_DENSITY },
});

/**
 * Standart malzemenin sisini, bakış yönüne göre renk değiştiren su sisiyle değiştirir; böylece uzak
 * kayalar arkalarındaki dikey renk geçişine karışarak kaybolur.
 */
function withWaterFog<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms());
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wWater = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wWater = instanceMatrix * wWater;
        #endif
        vWaterPos = (modelMatrix * wWater).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWaterPos;\nuniform float uWaterDensity;\n${WATER_GLSL}`)
      .replace(
        '#include <fog_fragment>',
        `vec3 wRay = vWaterPos - cameraPosition;
        float wDist = length(wRay);
        float wFog = 1.0 - exp(-uWaterDensity * uWaterDensity * wDist * wDist);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, waterColor(wRay / wDist), wFog);`,
      );
  };
  return m;
}

function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- sahne

export interface Exterior {
  update: (dt: number, time: number, camera: THREE.Camera) => void;
  /** Dış grup bu karede çizildi mi (pencere görüş alanında mı). */
  readonly visible: boolean;
  /** Geliştirme/test: büyük gölgenin geçişini, yolun `k` (0..1) noktasından hemen başlatır. */
  forcePass: (k: number) => void;
}

export function buildExterior(scene: THREE.Scene, L: CorridorLayout): Exterior {
  const outside = new THREE.Group();
  outside.name = 'exterior';
  scene.add(outside);
  const zMid = (L.zStart + L.zEnd) / 2;
  const rng = createRng(77);
  const windows = L.placements.filter((p) => p.model === 'WallAstra_Straight_Window');

  // Dikey renk geçişli su kubbesi (en önce çizilir, derinlik yazmaz)
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: waterUniforms(),
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `${WATER_GLSL}\nvarying vec3 vW; void main(){ gl_FragColor = vec4(waterColor(normalize(vW - cameraPosition)), 1.0); }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  dome.position.set(-6, 0, zMid);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  outside.add(dome);

  // Deniz tabanı: koridorun dışından başlar
  const width = 72;
  const depth = 76;
  const bedGeo = new THREE.PlaneGeometry(width, depth, 40, 42).rotateX(-Math.PI / 2);
  bedGeo.translate(OUTSIDE_X - width / 2, 0, zMid);
  const pos = bedGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, seabedHeight(pos.getX(i), pos.getZ(i)));
  bedGeo.computeVertexNormals();
  const seabed = new THREE.Mesh(bedGeo, withWaterFog(new THREE.MeshStandardMaterial({ color: 0x24322c, roughness: 1, flatShading: true })));
  outside.add(seabed);

  // Kayalar: pürüzlü ikosahedronlar, tek InstancedMesh
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rp = rockGeo.getAttribute('position');
  for (let i = 0; i < rp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(rp, i);
    v.multiplyScalar(0.75 + hash(v.x * 3.1 + v.y, v.z * 2.7 - v.y) * 0.5); // aynı köşe her yüzde aynı kayar → çatlak yok
    rp.setXYZ(i, v.x, v.y, v.z);
  }
  rockGeo.computeVertexNormals();
  const spots = rockLayout();
  const rocks = new THREE.InstancedMesh(rockGeo, withWaterFog(new THREE.MeshStandardMaterial({ color: 0x2f3b3a, roughness: 1, flatShading: true })), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach((r, k) =>
    rocks.setMatrixAt(
      k,
      m.compose(new THREE.Vector3(r.x, r.y, r.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r.rotY, 0)), new THREE.Vector3(r.scale, r.scale * r.squash, r.scale * 1.1)),
    ),
  );
  rocks.instanceMatrix.needsUpdate = true;
  rocks.computeBoundingSphere();
  outside.add(rocks);

  // Işık huzmeleri: eğik, yarı saydam, toplamsal; tek birleşik geometri
  const shafts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const g = new THREE.PlaneGeometry(1.2 + rng() * 1.6, 24);
    g.rotateZ(-0.35 - rng() * 0.15).rotateY(rng() * Math.PI);
    g.translate(-6 - rng() * 16, 6, L.zEnd + 4 + rng() * (L.zStart - L.zEnd));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count).fill(rng() * 6.28), 1));
    shafts.push(g);
  }
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `attribute float aPhase; varying vec2 vUv; varying float vPhase; varying vec3 vW;
      void main(){ vUv = uv; vPhase = aPhase; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vPhase; varying vec3 vW;
      void main(){
        float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
        float fall = smoothstep(0.05, 0.95, vUv.y);
        float flicker = 0.16 + 0.05 * sin(uTime * 0.6 + vPhase) + 0.025 * sin(uTime * 2.1 + vPhase * 3.0);
        float dist = exp(-length(vW - cameraPosition) * 0.025);
        gl_FragColor = vec4(vec3(0.55, 0.9, 0.95) * edge * fall * flicker * dist, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  outside.add(new THREE.Mesh(mergeGeometries(shafts), shaftMat));

  // Deniz karı: yavaşça süzülen parçacıklar
  const dot = softDot();
  const SNOW = 700;
  const box = { x0: -26, x1: OUTSIDE_X - 0.4, y0: -3, y1: 13, z0: L.zEnd - 10, z1: L.zStart + 8 };
  const snowPos = new Float32Array(SNOW * 3);
  const snowVel = new Float32Array(SNOW * 2); // düşüş hızı, salınım fazı
  for (let i = 0; i < SNOW; i++) {
    snowPos.set([box.x0 + rng() * (box.x1 - box.x0), box.y0 + rng() * (box.y1 - box.y0), box.z0 + rng() * (box.z1 - box.z0)], i * 3);
    snowVel.set([0.04 + rng() * 0.1, rng() * 6.28], i * 2);
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({ map: dot, color: 0xcfe8e6, size: 0.06, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  snow.frustumCulled = false;
  outside.add(snow);

  // Kabarcıklar: ara sıra deniz tabanından yükselen kümeler
  const BUBBLES = 48;
  const bubPos = new Float32Array(BUBBLES * 3).fill(-1000);
  const bub = Array.from({ length: BUBBLES }, () => ({ alive: false, vy: 0, phase: 0, x: 0, z: 0 }));
  const bubGeo = new THREE.BufferGeometry();
  bubGeo.setAttribute('position', new THREE.BufferAttribute(bubPos, 3));
  const bubbles = new THREE.Points(bubGeo, new THREE.PointsMaterial({ map: dot, color: 0xe8fbff, size: 0.11, transparent: true, opacity: 0.75, depthWrite: false }));
  bubbles.frustumCulled = false;
  outside.add(bubbles);
  let nextBurst = 3 + rng() * 5;
  const burst = (time: number) => {
    const w = windows[Math.floor(rng() * windows.length)];
    const cx = -4.5 - rng() * 7;
    const cz = (w?.z ?? zMid) + (rng() - 0.5) * 5;
    let n = 6 + Math.floor(rng() * 6);
    for (let i = 0; i < BUBBLES && n > 0; i++) {
      if (bub[i].alive) continue;
      bub[i] = { alive: true, vy: 0.45 + rng() * 0.45, phase: rng() * 6.28, x: cx + (rng() - 0.5) * 0.6, z: cz + (rng() - 0.5) * 0.6 };
      bubPos.set([bub[i].x, seabedHeight(cx, cz) - rng() * 0.8, bub[i].z], i * 3);
      n--;
    }
    nextBurst = time + 5 + rng() * 9;
  };

  // Nadiren pencerenin önünden geçen büyük, belirsiz gölge
  const bodyGeo = new THREE.SphereGeometry(1, 16, 10).scale(1.6, 1.1, 6.5);
  const tailGeo = new THREE.ConeGeometry(1.4, 3, 6).rotateX(-Math.PI / 2).scale(0.25, 1, 1).translate(0, 0, 7.2);
  const finGeo = new THREE.ConeGeometry(0.9, 3.2, 4).rotateZ(Math.PI / 2).scale(1, 0.18, 1).translate(0, -0.3, -1);
  const shadow = new THREE.Mesh(mergeGeometries([bodyGeo, tailGeo, finGeo, finGeo.clone().rotateY(Math.PI)]), withWaterFog(new THREE.MeshBasicMaterial({ color: 0x041c22 })));
  shadow.visible = false;
  outside.add(shadow);
  const pass = { active: false, start: 0, next: 25 + rng() * 25, duration: 42, x: -15 };

  // Pencere önü zeminde dalgalı ışık deseni (koridorun içinde; dış grup gizliyken de görünür)
  const patches = windows.map((w) => {
    const g = new THREE.PlaneGeometry(1.5, MODULE * 0.85).rotateX(-Math.PI / 2);
    g.translate(-WALL_INNER + 0.75, 0.012, w.z);
    return g;
  });
  const causticMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
      // Kendi yazdığımız sırtlı dalga deseni: dört kayan sinüsün mutlak toplamının tersi
      float ridge(vec2 p, float t) {
        float w = sin(p.x * 1.9 + t) + sin(p.y * 2.3 - t * 1.2) + sin((p.x + p.y) * 1.4 + t * 0.8) + sin(length(p - vec2(3.0, -2.0)) * 2.6 - t * 1.1);
        return pow(clamp(1.0 - abs(w) * 0.3, 0.0, 1.0), 7.0);
      }
      void main(){
        vec2 p = vW.xz * 2.2;
        float c = ridge(p, uTime * 0.9) * 0.7 + ridge(p * 1.7 + 4.0, uTime * 1.3) * 0.45;
        float wall = smoothstep(1.0, 0.0, vUv.x);          // pencereye yakın taraf güçlü
        float ends = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
        gl_FragColor = vec4(vec3(0.45, 0.85, 0.9) * c * wall * ends * 0.55, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  if (patches.length) scene.add(new THREE.Mesh(mergeGeometries(patches), causticMat));

  // Görünürlük: pencere modüllerinin kutuları görüş alanında mı
  const windowBoxes = windows.map((w) => new THREE.Box3(new THREE.Vector3(-2.9, 0, w.z - MODULE / 2), new THREE.Vector3(-1.5, 3.2, w.z + MODULE / 2)));
  const frustum = new THREE.Frustum();
  const vp = new THREE.Matrix4();

  let now = 0;
  return {
    get visible() {
      return outside.visible;
    },
    forcePass(k) {
      Object.assign(pass, { active: true, start: now - k * pass.duration, x: -20 });
    },
    update(dt, time, camera) {
      now = time;
      causticMat.uniforms.uTime.value = time;
      camera.updateMatrixWorld();
      vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(vp);
      outside.visible = windowBoxes.some((b) => frustum.intersectsBox(b));

      // Zamanlayıcılar görünmezken de işler; parçacıklar yalnız görünürken güncellenir.
      if (time > nextBurst) burst(time);
      if (!pass.active && time > pass.next) Object.assign(pass, { active: true, start: time, x: -19 - rng() * 5 });
      if (pass.active) {
        const k = (time - pass.start) / pass.duration;
        if (k >= 1) Object.assign(pass, { active: false, next: time + 50 + rng() * 60 });
        shadow.visible = pass.active;
        shadow.position.set(pass.x + Math.sin(time * 0.15) * 1.5, 4.5 + Math.sin(time * 0.4) * 0.6, L.zStart + 16 - k * (L.zStart - L.zEnd + 32));
        shadow.rotation.set(Math.sin(time * 0.4) * 0.05, Math.sin(time * 0.15) * 0.12, 0);
      }
      if (!outside.visible) return;

      shaftMat.uniforms.uTime.value = time;
      for (let i = 0; i < SNOW; i++) {
        const o = i * 3;
        snowPos[o + 1] -= snowVel[i * 2] * dt;
        snowPos[o] += Math.sin(time * 0.35 + snowVel[i * 2 + 1]) * 0.05 * dt;
        snowPos[o + 2] += Math.cos(time * 0.27 + snowVel[i * 2 + 1]) * 0.05 * dt;
        if (snowPos[o + 1] < box.y0) snowPos[o + 1] = box.y1;
      }
      snowGeo.getAttribute('position').needsUpdate = true;
      for (let i = 0; i < BUBBLES; i++) {
        const b = bub[i];
        if (!b.alive) continue;
        const o = i * 3;
        bubPos[o + 1] += b.vy * dt;
        bubPos[o] = b.x + Math.sin(time * 3 + b.phase) * 0.08;
        bubPos[o + 2] = b.z + Math.cos(time * 2.4 + b.phase) * 0.08;
        if (bubPos[o + 1] > box.y1) {
          b.alive = false;
          bubPos[o + 1] = -1000;
        }
      }
      bubGeo.getAttribute('position').needsUpdate = true;
    },
  };
}
