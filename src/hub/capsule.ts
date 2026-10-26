// Kaçış kapsülü (final): akrilik küre kabin (her yön görünür: aşağıda istasyon, yukarıda yüzey), çerçeve halkaları,
// taban, koltuk sırtı, konsol ve iki tuval ekran (derinlik/hız, sonar); kapsülle birlikte akan parçacıklar (yükselişi
// hissettirir), fırlatmada kabarcık bulutu ve A-1'in dışındaki yuva (taban halkası + üç kenet). Hiç model indirilmez;
// parçalar kodla kurulur, malzemeye göre birleştirilir (≈ 10 çizim çağrısı). Gölge yok, ışık kaynağı yok (kabin
// lambası hub'daki LED ışığını ödünç alır).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { screenCanvas } from './cockpit';
import { softDot, withWaterFog } from './exterior';

export interface CapsuleStatus {
  depth: number;
  /** Derinlik göstergesinin değişim hızı (m/sn). */
  rate: number;
  sonar: 'idle' | 'contact' | 'lost';
  /** Temasın uzaklığı (m) ve kapsülün burnuna göre yönü (radyan); sonar ekranı için. */
  contact: { range: number; bearing: number } | null;
  surfaced: boolean;
}

export interface Capsule {
  /** Kabin: kapsülle hareket eder (hub yerleştirir). */
  readonly root: THREE.Group;
  /** Yuva: tabanda kalır. */
  readonly cradle: THREE.Group;
  readonly status: CapsuleStatus;
  /** Gözün kabindeki yeri (yerel). */
  readonly eye: THREE.Vector3;
  /** Kenetler: 0 kapalı … 1 açık. */
  setClamps: (k: number) => void;
  /** Dünyadaki yükselme hızı (m/sn): parçacıklar buna göre akar. */
  setRiseSpeed: (v: number) => void;
  /** Parçacıklar (su altında) görünsün mü. */
  setParticles: (on: boolean) => void;
  burst: () => void;
  setVisible: (on: boolean) => void;
  update: (dt: number, time: number) => void;
}

const R = 1.25;
const EYE = new THREE.Vector3(0, 0.12, 0.08);
const SNOW = 320;
const SNOW_R: [number, number] = [1.7, 9];
const SNOW_H = 12;
const BUBBLES = 90;

export function buildCapsule(parent: THREE.Object3D, at: { x: number; y: number; z: number; yaw: number }): Capsule {
  const root = new THREE.Group();
  root.name = 'capsule';
  root.position.set(at.x, at.y, at.z);
  root.rotation.y = at.yaw;
  parent.add(root);

  // Akrilik küre: içeriden arka yüzü çizilir; hafif camgöbeği, derinlik yazmaz
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(R, 40, 24),
    new THREE.MeshBasicMaterial({ color: 0xa8dde6, transparent: true, opacity: 0.08, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  glass.renderOrder = 2;
  root.add(glass);

  // Çerçeve: ekvator halkası (göz hizasının altında), arkada iki dikey yarım halka, tepede kapak halkası; taban, koltuk
  // sırtı ve konsol gövdesi aynı koyu metal
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(R, 0.045, 6, 64).rotateX(Math.PI / 2).translate(0, -0.28, 0)];
  for (const a of [-0.55, 0.55]) parts.push(new THREE.TorusGeometry(R, 0.04, 6, 40, Math.PI).rotateY(Math.PI / 2 + a));
  const hatchY = Math.sqrt(R * R - 0.42 * 0.42);
  parts.push(new THREE.TorusGeometry(0.42, 0.05, 6, 28).rotateX(Math.PI / 2).translate(0, hatchY - 0.02, 0));
  parts.push(new THREE.CylinderGeometry(0.66, 0.74, 0.14, 28).translate(0, -0.96, 0));
  parts.push(new THREE.BoxGeometry(0.62, 0.62, 0.1).translate(0, -0.42, 0.52)); // sırt göz hizasının altında: geriye bakış açık
  const consoleGeo = new THREE.BoxGeometry(0.8, 0.22, 0.26).rotateX(-0.5).translate(0, -0.8, -0.62);
  parts.push(consoleGeo);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a484e, roughness: 0.55, metalness: 0.55 });
  root.add(new THREE.Mesh(mergeGeometries(parts), metal));

  // Konsol ekranları (Müren'dekiyle aynı tuval yardımcısı)
  const sonar = screenCanvas(256, 200);
  const stat = screenCanvas(256, 200);
  const screenGeo = (x: number) => new THREE.PlaneGeometry(0.33, 0.25).rotateX(-0.5 - Math.PI / 12).translate(x, -0.64, -0.68);
  root.add(new THREE.Mesh(screenGeo(-0.18), new THREE.MeshBasicMaterial({ map: sonar.tex, toneMapped: false })));
  root.add(new THREE.Mesh(screenGeo(0.18), new THREE.MeshBasicMaterial({ map: stat.tex, toneMapped: false })));

  // Tavan lambası (yalnız parlayan malzeme) ve tepedeki dış fener
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20).rotateX(Math.PI / 2).translate(0, hatchY - 0.05, 0), new THREE.MeshBasicMaterial({ color: 0xffe6c0 }));
  root.add(lamp);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  root.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6).translate(0.3, hatchY + 0.07, 0), beaconMat));

  // Kapsülle birlikte akan parçacıklar (kapsülün yerel uzayında; yükseldikçe aşağı akar)
  const dot = softDot();
  const snowPos = new Float32Array(SNOW * 3);
  const snowDrift = new Float32Array(SNOW);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < SNOW; i++) {
    const a = rnd() * Math.PI * 2;
    const r = SNOW_R[0] + (SNOW_R[1] - SNOW_R[0]) * Math.sqrt(rnd());
    snowPos.set([Math.cos(a) * r, (rnd() * 2 - 1) * SNOW_H, Math.sin(a) * r], i * 3);
    snowDrift[i] = 0.03 + rnd() * 0.08;
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ map: dot, color: 0xcfe8e6, size: 0.075, transparent: true, opacity: 0.7, depthWrite: false }));
  snow.frustumCulled = false;
  root.add(snow);

  // Fırlatma kabarcıkları: kapsülün altından, kapsülden hızlı yükselir
  const bubPos = new Float32Array(BUBBLES * 3).fill(-1000);
  const bubVel = new Float32Array(BUBBLES);
  const bubGeo = new THREE.BufferGeometry();
  bubGeo.setAttribute('position', new THREE.BufferAttribute(bubPos, 3));
  const bubbles = new THREE.Points(bubGeo, new THREE.PointsMaterial({ map: dot, color: 0xe8fbff, size: 0.12, transparent: true, opacity: 0.8, depthWrite: false }));
  bubbles.frustumCulled = false;
  root.add(bubbles);

  // Yuva: taban halkası ve üç kenet (her biri ayrı döner), iki turuncu işaret lambası
  const cradle = new THREE.Group();
  cradle.name = 'capsule-cradle';
  cradle.position.set(at.x, at.y - R - 0.15, at.z);
  parent.add(cradle);
  const dark = withWaterFog(new THREE.MeshStandardMaterial({ color: 0x2b3639, roughness: 0.8, metalness: 0.5, emissive: 0x0b1416 }));
  cradle.add(new THREE.Mesh(mergeGeometries([new THREE.CylinderGeometry(1.5, 1.75, 0.4, 24), new THREE.CylinderGeometry(0.8, 0.8, 0.5, 16).translate(0, 0.2, 0)]), dark));
  const clamps = [0, 1, 2].map((k) => {
    const pivot = new THREE.Group();
    pivot.rotation.y = (k / 3) * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.34).translate(0, 0.55, 0), dark);
    arm.position.set(1.2, 0.15, 0);
    pivot.add(arm);
    cradle.add(pivot);
    return arm;
  });
  const marker = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  cradle.add(new THREE.Mesh(mergeGeometries([0, 1].map((k) => new THREE.SphereGeometry(0.08, 8, 6).translate(Math.cos(k * Math.PI) * 1.6, 0.25, Math.sin(k * Math.PI) * 1.6))), marker));

  const status: CapsuleStatus = { depth: 221, rate: 0, sonar: 'idle', contact: null, surfaced: false };
  let rise = 0;
  let drawT = 0;

  const drawSonar = (time: number) => {
    const { g, c } = sonar;
    g.fillStyle = '#021014';
    g.fillRect(0, 0, c.width, c.height);
    const cx = 128;
    const cy = 108;
    g.strokeStyle = 'rgba(80,220,200,0.35)';
    for (const r of [28, 56, 84]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    const a = (time * 1.4) % (Math.PI * 2);
    g.strokeStyle = 'rgba(120,255,220,0.9)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 84, cy + Math.sin(a) * 84);
    g.stroke();
    g.fillStyle = '#7fe8d8';
    g.fillRect(cx - 2, cy - 2, 4, 4);
    if (status.sonar === 'contact' && status.contact) {
      const r = Math.min(84, (status.contact.range / 60) * 84);
      g.fillStyle = `rgba(255,90,70,${0.55 + 0.45 * Math.sin(time * 9)})`;
      g.beginPath();
      g.ellipse(cx + Math.sin(status.contact.bearing) * r, cy + Math.cos(status.contact.bearing) * r, 16, 7, status.contact.bearing, 0, Math.PI * 2);
      g.fill();
    }
    g.font = 'bold 15px monospace';
    g.fillStyle = status.sonar === 'contact' ? '#ff6a50' : '#7fe8d8';
    const label =
      status.sonar === 'contact' && status.contact ? `TEMAS: ALTTA ${Math.round(status.contact.range)} m` : status.sonar === 'lost' ? 'TEMAS KAYBOLDU' : 'SONAR';
    g.fillText(label, 10, 20);
    sonar.tex.needsUpdate = true;
  };
  const drawStat = (time: number) => {
    const { g, c } = stat;
    g.fillStyle = '#021014';
    g.fillRect(0, 0, c.width, c.height);
    g.font = 'bold 22px monospace';
    if (status.surfaced) {
      g.fillStyle = Math.sin(time * 4) > -0.3 ? '#7dff9a' : '#2a5a36';
      g.fillText('YÜZEY', 10, 32);
    } else {
      g.fillStyle = '#7fe8d8';
      g.fillText(`DERİNLİK ${Math.round(status.depth)} m`, 10, 32);
    }
    g.font = '16px monospace';
    g.fillStyle = '#9bb';
    g.fillText(`YÜKSELİŞ ${status.rate.toFixed(1).replace('.', ',')} m/sn`, 10, 60);
    // Derinlik çubuğu: üst yüzey, alt istasyon
    g.fillStyle = '#0d2a31';
    g.fillRect(210, 14, 24, 172);
    const y = 14 + 172 * Math.min(1, status.depth / 221);
    g.fillStyle = '#3ad0c0';
    g.fillRect(206, y - 3, 32, 6);
    g.fillStyle = '#9bb';
    g.fillText('0', 186, 26);
    g.fillText('221', 160, 186);
    g.fillStyle = status.depth < 60 ? '#ffd040' : '#3a6a70';
    g.fillText(status.depth < 60 ? 'IŞIK' : '', 10, 92);
    stat.tex.needsUpdate = true;
  };

  return {
    root,
    cradle,
    status,
    eye: EYE,
    setClamps(k) {
      for (const arm of clamps) arm.rotation.z = -k * 1.1;
    },
    setRiseSpeed(v) {
      rise = v;
    },
    setParticles(on) {
      snow.visible = on;
      bubbles.visible = on;
    },
    burst() {
      for (let i = 0; i < BUBBLES; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.3 + rnd() * 1.4;
        bubPos.set([Math.cos(a) * r, -R - rnd() * 1.5, Math.sin(a) * r], i * 3);
        bubVel[i] = 1.6 + rnd() * 2.2;
      }
    },
    setVisible(on) {
      root.visible = on;
      cradle.visible = on;
    },
    update(dt, time) {
      if (!root.visible) return;
      for (let i = 0; i < SNOW; i++) {
        const o = i * 3 + 1;
        snowPos[o] -= (rise + snowDrift[i]) * dt;
        if (snowPos[o] < -SNOW_H) snowPos[o] += 2 * SNOW_H;
        else if (snowPos[o] > SNOW_H) snowPos[o] -= 2 * SNOW_H;
      }
      snowGeo.getAttribute('position').needsUpdate = true;
      for (let i = 0; i < BUBBLES; i++) {
        const o = i * 3 + 1;
        if (bubPos[o] < -999) continue;
        // Kabarcık dünyada vy ile yükselir; kapsülün uzayında farkı kadar
        bubPos[o] += (bubVel[i] - rise) * dt;
        bubPos[o - 1] += Math.sin(time * 3 + i) * 0.1 * dt;
        if (bubPos[o] > SNOW_H) bubPos[o] = -1000;
      }
      bubGeo.getAttribute('position').needsUpdate = true;
      beaconMat.color.setHex(Math.sin(time * 3) > 0.6 ? 0xff3020 : 0x3a0806);
      drawT -= dt;
      if (drawT <= 0) {
        drawT = 1 / 8;
        drawSonar(time);
        drawStat(time);
      }
    },
  };
}
