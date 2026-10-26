// Yüzey (final). Alttan: parlak, dalgalı tavan (Snell penceresi; derinlik azaldıkça belirginleşir). Üstten: şafak
// göğü, dalgalı deniz (ufukta pusa karışır, güneşin yansıması), destek gemisinin silueti (aydınlık pencereler, seyir
// ve güverte fenerleri), kapsüle dönen projektör huzmesi ve yaklaşan bot. Işık kaynağı yok: her şey kendi rengini
// yayan malzeme ya da toplamsal geometri; gölge yok. Gök kamerayı izler; deniz kapsülün çevresinde sabittir.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { softDot } from './exterior';

export type SurfaceMode = 'off' | 'below' | 'above';

export interface Surface {
  readonly group: THREE.Group;
  readonly mode: SurfaceMode;
  setMode: (m: SurfaceMode) => void;
  /** Alttan bakarken parlaklık: 0 (görünmez) … 1 (hemen altı). */
  setBelow: (k: number) => void;
  /** Projektör kapsüle döner: 0 kapalı … 1 kapsülün üstünde. */
  setSearchlight: (k: number) => void;
  /** Bot gemiden kapsüle: 0 gemide … 1 kapsülün yanında. */
  setBoat: (k: number) => void;
  shipPoint: (out: THREE.Vector3) => THREE.Vector3;
  boatPoint: (out: THREE.Vector3) => THREE.Vector3;
  update: (dt: number, time: number, camera: THREE.Camera) => void;
}

/** Dalga yüksekliği (m): denizin köşe gölgelendiricisiyle aynı toplam (kapsül ve bot bununla sallanır). */
export function waveHeight(x: number, z: number, t: number): number {
  return 0.16 * Math.sin(0.35 * x + 0.12 * z + 1.1 * t) + 0.11 * Math.sin(-0.21 * x + 0.4 * z + 1.6 * t) + 0.05 * Math.sin(0.7 * x - 0.5 * z + 2.3 * t);
}

const WAVE_GLSL = /* glsl */ `
float waveH(vec2 p, float t) {
  return 0.16 * sin(0.35 * p.x + 0.12 * p.y + 1.1 * t) + 0.11 * sin(-0.21 * p.x + 0.4 * p.y + 1.6 * t) + 0.05 * sin(0.7 * p.x - 0.5 * p.y + 2.3 * t);
}`;

// Şafak (sRGB)
const ZENITH = new THREE.Color(0x1a2848);
const MID = new THREE.Color(0x5b6c9c);
const HORIZON = new THREE.Color(0xf0a46c);
const DEEP = new THREE.Color(0x0e1e2a);
const SUN = new THREE.Color(0xffc888);

const SHIP_DISTANCE = 120;
const BOAT_STOP = 9;

export function buildSurface(scene: THREE.Scene, o: { x: number; z: number; y: number; shipDir: number }): Surface {
  const group = new THREE.Group();
  group.name = 'surface';
  group.visible = false;
  scene.add(group);
  const toShip = new THREE.Vector3(-Math.sin(o.shipDir), 0, -Math.cos(o.shipDir));
  // Güneş geminin biraz yanında, ufkun hemen üstünde: gemi aydınlık ufka karşı siluet olur
  const sunAz = o.shipDir + 0.22;
  const sunDir = new THREE.Vector3(-Math.sin(sunAz) * Math.cos(0.05), Math.sin(0.05), -Math.cos(sunAz) * Math.cos(0.05)).normalize();
  const colorUniforms = () => ({
    uSunDir: { value: sunDir },
    uHorizon: { value: HORIZON },
    uMid: { value: MID },
    uZenith: { value: ZENITH },
    uDeep: { value: DEEP },
    uSun: { value: SUN },
  });

  // --- Alttan: parlak tavan
  const ceilingMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uK: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform float uK; varying vec3 vW;
      float ridge(vec2 p, float t) {
        float w = sin(p.x * 1.9 + t) + sin(p.y * 2.3 - t * 1.2) + sin((p.x + p.y) * 1.4 + t * 0.8) + sin(length(p - vec2(3.0, -2.0)) * 2.6 - t * 1.1);
        return pow(clamp(1.0 - abs(w) * 0.3, 0.0, 1.0), 6.0);
      }
      void main(){
        vec3 d = normalize(vW - cameraPosition);
        float win = smoothstep(0.5, 0.92, clamp(d.y, 0.0, 1.0));
        float r = ridge(vW.xz * 0.45, uTime * 0.9) * 0.6 + ridge(vW.xz * 0.8 + 3.0, uTime * 1.3) * 0.4;
        vec3 c = vec3(0.55, 0.8, 0.82) * (0.2 + 0.8 * win) + vec3(1.0) * win * r * 0.9;
        gl_FragColor = vec4(c * uK, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(80, 48).rotateX(Math.PI / 2), ceilingMat);
  ceiling.frustumCulled = false;
  group.add(ceiling);

  // --- Üstten: gök kubbesi (kamerayı izler)
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: colorUniforms(),
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform vec3 uSunDir; uniform vec3 uHorizon; uniform vec3 uMid; uniform vec3 uZenith; uniform vec3 uDeep; uniform vec3 uSun; varying vec3 vW;
        void main(){
          vec3 d = normalize(vW - cameraPosition);
          float h = d.y;
          vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
          c = mix(c, uZenith, smoothstep(0.2, 0.75, h));
          float s = max(dot(d, uSunDir), 0.0);
          c += uSun * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6 + pow(s, 1200.0) * 4.0);
          if (h < 0.0) c = mix(uHorizon, uDeep, smoothstep(0.0, -0.08, h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  group.add(sky);

  // --- Deniz: kapsülün çevresinde, köşelerde dalga; kapsülün içinden geçmesin diye çevresi delik
  const seaMat = new THREE.ShaderMaterial({
    uniforms: { ...colorUniforms(), uTime: { value: 0 }, uHole: { value: new THREE.Vector3(o.x, o.z, 1.2) } },
    vertexShader: `uniform float uTime; varying vec3 vW; varying vec3 vN; ${WAVE_GLSL}
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y += waveH(w.xz, uTime);
        float e = 0.25;
        float hx = waveH(w.xz + vec2(e, 0.0), uTime) - waveH(w.xz - vec2(e, 0.0), uTime);
        float hz = waveH(w.xz + vec2(0.0, e), uTime) - waveH(w.xz - vec2(0.0, e), uTime);
        vN = normalize(vec3(-hx, 2.0 * e, -hz));
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `uniform vec3 uSunDir; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uDeep; uniform vec3 uSun; uniform vec3 uHole;
      varying vec3 vW; varying vec3 vN;
      void main(){
        if (length(vW.xz - uHole.xy) < uHole.z) discard;
        vec3 v = normalize(cameraPosition - vW);
        vec3 n = normalize(vN);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        vec3 skyc = mix(uHorizon, uZenith, smoothstep(0.0, 0.45, r.y));
        float glint = pow(max(dot(r, uSunDir), 0.0), 180.0);
        vec3 c = mix(uDeep, skyc, 0.12 + 0.8 * fres) + uSun * glint * 2.5;
        float d = length(vW.xz - cameraPosition.xz);
        c = mix(c, uHorizon, smoothstep(70.0, 190.0, d));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 100, 100).rotateX(-Math.PI / 2).translate(o.x, o.y, o.z), seaMat);
  sea.frustumCulled = false;
  group.add(sea);

  // --- Destek gemisi: baş +x; silueti tek koyu malzeme, pencereleri ayrı parlak malzeme
  const ship = new THREE.Group();
  ship.position.copy(new THREE.Vector3(o.x, o.y, o.z).addScaledVector(toShip, SHIP_DISTANCE));
  ship.rotation.y = o.shipDir; // baş-kıç ekseni bakış doğrultusuna dik: borda kapsüle dönük
  group.add(ship);
  const profile = new THREE.Shape([
    new THREE.Vector2(-23, -1.5),
    new THREE.Vector2(-23, 3.2),
    new THREE.Vector2(15, 3.2),
    new THREE.Vector2(23, 4.8),
    new THREE.Vector2(20.5, -1.5),
  ]);
  const hull = new THREE.ExtrudeGeometry(profile, { depth: 9, bevelEnabled: false }).translate(0, 0, -4.5);
  const hp = hull.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    if (x > 12) hp.setZ(i, hp.getZ(i) * (1 - Math.min(1, (x - 12) / 11) * 0.85)); // baş daralır
  }
  hull.computeVertexNormals();
  const box = (x0: number, x1: number, y0: number, y1: number, hz: number) => new THREE.BoxGeometry(x1 - x0, y1 - y0, 2 * hz).translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  const leg = (x0: number, y0: number, x1: number, y1: number, z: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    return new THREE.BoxGeometry(0.5, len, 0.5)
      .rotateZ(-Math.atan2(x1 - x0, y1 - y0))
      .translate((x0 + x1) / 2, (y0 + y1) / 2, z);
  };
  const silhouette = mergeGeometries(
    [
      hull,
      box(5, 14, 3.2, 9.5, 3.6),
      box(7.5, 13.5, 9.5, 12, 3),
      box(-7, 5, 3.2, 6.8, 4),
      box(-2.2, 0.8, 6.8, 11.5, 1.2),
      box(10.2, 10.8, 12, 21, 0.3),
      box(8.8, 12.2, 17, 17.4, 0.25),
      leg(-21.5, 3.2, -19.5, 11.5, 3.6),
      leg(-21.5, 3.2, -19.5, 11.5, -3.6),
      box(-20.2, -18.8, 11, 11.8, 3.9),
      leg(-9, 6.8, -15, 13, 0),
    ].map((g) => (g.index ? g.toNonIndexed() : g)),
  );
  ship.add(new THREE.Mesh(silhouette, new THREE.MeshBasicMaterial({ color: 0x0b1018, fog: false })));
  const windows: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (let x = 8; x <= 13; x += 1.15) windows.push(new THREE.PlaneGeometry(0.8, 0.55).rotateY(side > 0 ? 0 : Math.PI).translate(x, 10.6, side * 3.02));
    for (let x = -6; x <= 4; x += 1.6) windows.push(new THREE.PlaneGeometry(0.7, 0.5).rotateY(side > 0 ? 0 : Math.PI).translate(x, 5.2, side * 4.02));
    for (let x = 6; x <= 13; x += 1.75) windows.push(new THREE.PlaneGeometry(0.9, 0.6).rotateY(side > 0 ? 0 : Math.PI).translate(x, 7.6, side * 3.62));
  }
  ship.add(new THREE.Mesh(mergeGeometries(windows), new THREE.MeshBasicMaterial({ color: 0xffcf88, toneMapped: false, fog: false })));
  // Fenerler: direk (beyaz), iki borda (kırmızı/yeşil), kıç (beyaz), A-çerçevede iki güverte projektörü
  const dot = softDot();
  const lampPts: [number, number, number, number][] = [
    [10.5, 21.2, 0, 0xffffff],
    [12.5, 9.8, 3.7, 0x30ff60],
    [12.5, 9.8, -3.7, 0xff3030],
    [-23, 5, 0, 0xffffff],
    [-20.2, 11.4, 3.2, 0xfff2d0],
    [-20.2, 11.4, -3.2, 0xfff2d0],
  ];
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPts.flatMap((p) => [p[0], p[1], p[2]]), 3));
  lampGeo.setAttribute('color', new THREE.Float32BufferAttribute(lampPts.flatMap((p) => new THREE.Color(p[3]).toArray()), 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ map: dot, size: 9, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
  ship.add(lamps);

  // --- Projektör: köprü üstünden kapsüle; dar kaynak, geniş uç; toplamsal, uca doğru söner
  const beamSrc = new THREE.Vector3(12, 12.4, 0);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uK; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){
        float fall = pow(1.0 - vUv.y, 1.4);
        float edge = pow(abs(dot(normalize(vN), normalize(cameraPosition - vW))), 1.6);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * fall * edge * 0.32 * uK, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.06, 1, 24, 1, true).translate(0, 0.5, 0), beamMat);
  beam.frustumCulled = false;
  group.add(beam);
  const glareMat = new THREE.PointsMaterial({ map: dot, size: 10, sizeAttenuation: false, color: 0xfff4e0, transparent: true, depthWrite: false, toneMapped: false, fog: false });
  const glare = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), glareMat);
  group.add(glare);

  // --- Bot: kısa gövde, konsol, beyaz fener
  const boat = new THREE.Group();
  boat.add(
    new THREE.Mesh(
      mergeGeometries([new THREE.BoxGeometry(5, 0.9, 2.2).translate(0, 0.2, 0), new THREE.ConeGeometry(1.1, 1.6, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4).scale(1, 0.6, 1).translate(3.2, 0.25, 0), new THREE.BoxGeometry(1, 1, 1).translate(-0.6, 1.1, 0)].map((g) => (g.index ? g.toNonIndexed() : g))),
      new THREE.MeshBasicMaterial({ color: 0x10161d, fog: false }),
    ),
  );
  boat.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.6, 1.9, 0], 3)), new THREE.PointsMaterial({ map: dot, size: 8, sizeAttenuation: false, color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, fog: false })));
  group.add(boat);

  let mode: SurfaceMode = 'off';
  let beamK = 0;
  let boatK = 0;
  const capsuleAt = new THREE.Vector3(o.x, o.y, o.z);
  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const show = () => {
    group.visible = mode !== 'off';
    ceiling.visible = mode === 'below';
    for (const m of [sky, sea, ship]) m.visible = mode === 'above';
    beam.visible = glare.visible = mode === 'above' && beamK > 0;
    boat.visible = mode === 'above' && boatK > 0;
  };
  const boatPos = (out: THREE.Vector3, time: number) => {
    const k = boatK * boatK * (3 - 2 * boatK);
    const from = SHIP_DISTANCE * 0.62;
    out.copy(capsuleAt).addScaledVector(toShip, from + (BOAT_STOP - from) * k);
    out.y = o.y + waveHeight(out.x, out.z, time) * 0.8 + 0.15;
    return out;
  };
  let now = 0;

  return {
    group,
    get mode() {
      return mode;
    },
    setMode(m) {
      mode = m;
      show();
    },
    setBelow(k) {
      ceilingMat.uniforms.uK.value = Math.min(1, Math.max(0, k));
    },
    setSearchlight(k) {
      beamK = Math.min(1, Math.max(0, k));
      show();
    },
    setBoat(k) {
      boatK = Math.min(1, Math.max(0, k));
      show();
    },
    shipPoint: (out) => out.copy(beamSrc).applyMatrix4(ship.matrixWorld).setY(o.y + 6),
    boatPoint: (out) => boatPos(out, now),
    update(_dt, time, camera) {
      now = time;
      if (mode === 'off') return;
      camera.getWorldPosition(tmp);
      if (mode === 'below') {
        ceiling.position.set(tmp.x, o.y, tmp.z);
        ceilingMat.uniforms.uTime.value = time;
        return;
      }
      sky.position.copy(tmp);
      seaMat.uniforms.uTime.value = time;
      ship.updateMatrixWorld();
      // Gemi hafifçe yalpalar
      ship.rotation.z = Math.sin(time * 0.5) * 0.015;
      if (beamK > 0) {
        const src = beamSrc.clone().applyMatrix4(ship.matrixWorld);
        // Önce kapsülün yanını tarar, sonra üstüne oturur
        const sweep = (1 - beamK) * 0.5 * Math.sin(time * 0.8);
        const target = capsuleAt.clone().add(new THREE.Vector3(Math.cos(o.shipDir) * sweep * 30, 0, -Math.sin(o.shipDir) * sweep * 30));
        dir.subVectors(target, src);
        const len = dir.length();
        beam.position.copy(src);
        beam.quaternion.setFromUnitVectors(UP, dir.normalize());
        beam.scale.set(5.5, len, 5.5);
        beamMat.uniforms.uK.value = beamK;
        glare.position.copy(src);
        // Huzme kameraya dönükse parlama büyür
        camDir.subVectors(tmp, src).normalize();
        glareMat.size = 10 + 70 * beamK * THREE.MathUtils.smoothstep(dir.dot(camDir), 0.97, 1);
      }
      if (boatK > 0) {
        boatPos(boat.position, time);
        boat.rotation.set(Math.sin(time * 1.3) * 0.05, o.shipDir - Math.PI / 2, Math.sin(time * 1.7) * 0.04); // baş kapsüle
      }
    },
  };
}
