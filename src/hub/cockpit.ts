// Müren: prologun küçük denizaltısı. Dış gövde (sarı gövde, cam burun kubbesi, kızaklar, kuyruk) dış grupta durur;
// prologdan sonra enkaz olarak tabanda kalır ve koridor penceresinden görünür. İç kabin (konsol, iki tuval ekran,
// röle kutusu, pompa sürücüsü, kıyafet dolabı) yalnız kokpit kipinde çizilir. Hiç model indirilmez; her parça
// kodla kurulur ve malzemeye göre birleştirilir (kabin + gövde ≈ 10 çizim çağrısı).
// Hareket: iniş (yavaş, istasyonun önünde süzülür) → düşüş (burun aşağı, tabana çakılma) → enkaz duruşu.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { withWaterFog } from './exterior';

export type MurenTarget = 'relay' | 'pump' | 'locker';
export type MurenPhase = 'descent' | 'sink' | 'wreck';

export interface MurenStatus {
  depth: number;
  o2: number;
  power: number;
  ballast: 'ok' | 'none' | 'rejected';
  sonar: 'idle' | 'contact' | 'beacon';
  alarm: boolean;
  relayOk: boolean;
  pumpOk: boolean;
}

export interface Muren {
  root: THREE.Group;
  interior: THREE.Group;
  /** Koltuktaki göz noktası (dünya). */
  seat: (out: THREE.Vector3) => THREE.Vector3;
  /** Burnun baktığı yön (dünya, yatay açı). */
  heading: () => number;
  target: (t: MurenTarget, out: THREE.Vector3) => THREE.Vector3;
  setPhase: (p: MurenPhase) => void;
  readonly phase: MurenPhase;
  /** Düşüş bitti mi (çarpma anı bir kez bildirilir). */
  takeImpact: () => boolean;
  status: MurenStatus;
  update: (dt: number, time: number) => void;
}

const HULL_R = 1.3;
const SEAT = new THREE.Vector3(0, 0.2, 0.55);
const TARGETS: Record<MurenTarget, THREE.Vector3> = {
  relay: new THREE.Vector3(-0.86, 0.05, -0.1),
  pump: new THREE.Vector3(0.86, 0.0, -0.3),
  // Sağ duvarda, koltuğun biraz gerisinde (bakış sınırı ±115° içinde)
  locker: new THREE.Vector3(0.82, 0.05, 0.85),
};

export function screenCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { c, g: c.getContext('2d')!, tex };
}

export function buildMuren(parent: THREE.Object3D, wreck: { x: number; y: number; z: number; yaw: number }): Muren {
  const root = new THREE.Group();
  root.name = 'muren';
  parent.add(root);

  // --- Dış gövde ---
  const yellow = withWaterFog(new THREE.MeshStandardMaterial({ color: 0xc8962e, roughness: 0.55, metalness: 0.35, emissive: 0x1a1204 }));
  const dark = withWaterFog(new THREE.MeshStandardMaterial({ color: 0x2b3134, roughness: 0.7, metalness: 0.5 }));
  const body = new THREE.CylinderGeometry(HULL_R, HULL_R, 4, 18, 1, true).rotateX(Math.PI / 2).translate(0, 0, 1);
  const tail = new THREE.SphereGeometry(HULL_R, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 3);
  const finV = new THREE.BoxGeometry(0.08, 1.1, 0.9).translate(0, 1.1, 3.6);
  const finH = new THREE.BoxGeometry(2.6, 0.08, 0.7).translate(0, 0, 3.7);
  const hatchTop = new THREE.CylinderGeometry(0.42, 0.45, 0.25, 14).translate(0, HULL_R + 0.05, 1.6);
  root.add(new THREE.Mesh(mergeGeometries([body, tail, finV, finH, hatchTop].map((g) => g.toNonIndexed())), yellow));
  const ring = new THREE.TorusGeometry(HULL_R, 0.09, 8, 28).translate(0, 0, -1);
  const skids = [-0.8, 0.8].map((x) => new THREE.BoxGeometry(0.12, 0.12, 4.6).translate(x, -HULL_R - 0.3, 1));
  const struts = [-0.8, 0.8].flatMap((x) => [-0.4, 2.4].map((z) => new THREE.BoxGeometry(0.08, 0.45, 0.08).translate(x, -HULL_R - 0.08, z)));
  const thruster = new THREE.CylinderGeometry(0.3, 0.38, 0.6, 12).rotateX(Math.PI / 2).translate(0, 0, 4.4);
  const arms = [-1, 1].map((sx) => new THREE.BoxGeometry(0.1, 0.1, 1.1).translate(sx * 0.9, -0.9, -1.3));
  root.add(new THREE.Mesh(mergeGeometries([ring, ...skids, ...struts, thruster, ...arms].map((g) => g.toNonIndexed())), dark));
  // Cam burun kubbesi: içeriden bakış bunun içinden (çift yüz, hafif renkli)
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(HULL_R - 0.02, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).translate(0, 0, -1),
    withWaterFog(new THREE.MeshStandardMaterial({ color: 0x9fd8e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })),
  );
  glass.renderOrder = 2;
  root.add(glass);
  // Burun lambası (ışık kaynağı değil, parlayan malzeme)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  root.add(new THREE.Mesh(new THREE.CircleGeometry(0.16, 14).translate(0, -0.85, -2.05), lampMat));

  // --- İç kabin (içe bakan yüzler) ---
  const interior = new THREE.Group();
  interior.name = 'muren-interior';
  root.add(interior);
  const cabin = new THREE.MeshStandardMaterial({ color: 0x55636a, roughness: 0.75, metalness: 0.3, emissive: 0x0b1416, side: THREE.FrontSide });
  const plates: THREE.BufferGeometry[] = [
    new THREE.PlaneGeometry(2, 3.4).rotateX(-Math.PI / 2).translate(0, -0.85, 0.7), // zemin
    new THREE.PlaneGeometry(2, 3.4).rotateX(Math.PI / 2).translate(0, 0.95, 0.7), // tavan
    new THREE.PlaneGeometry(3.4, 1.8).rotateY(Math.PI / 2).translate(-1, 0.05, 0.7), // sol
    new THREE.PlaneGeometry(3.4, 1.8).rotateY(-Math.PI / 2).translate(1, 0.05, 0.7), // sağ
    new THREE.PlaneGeometry(2, 1.8).rotateY(Math.PI).translate(0, 0.05, 2.4), // arka
  ];
  interior.add(new THREE.Mesh(mergeGeometries(plates), cabin));
  const fittings = new THREE.MeshStandardMaterial({ color: 0x3a4448, roughness: 0.55, metalness: 0.55, emissive: 0x070c0e });
  const fit: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(1.9, 0.5, 0.55).rotateX(-0.5).translate(0, -0.55, -0.72), // konsol
    new THREE.BoxGeometry(0.14, 0.5, 0.6).translate(TARGETS.relay.x - 0.03, TARGETS.relay.y, TARGETS.relay.z), // röle kutusu
    new THREE.BoxGeometry(0.14, 0.42, 0.5).translate(TARGETS.pump.x + 0.03, TARGETS.pump.y, TARGETS.pump.z), // pompa sürücüsü
    new THREE.BoxGeometry(0.3, 1.6, 0.7).translate(TARGETS.locker.x + 0.03, -0.05, TARGETS.locker.z), // dolap
    new THREE.BoxGeometry(0.6, 0.9, 0.12).translate(0, -0.2, 1.05), // koltuk sırtı
    new THREE.BoxGeometry(1.9, 0.08, 0.08).translate(0, 0.9, -0.95), // kanopi çerçevesi üst
  ];
  // Kablo demetleri tavanda
  for (const x of [-0.6, -0.45, 0.5]) fit.push(new THREE.CylinderGeometry(0.025, 0.025, 3.2, 5).rotateX(Math.PI / 2).translate(x, 0.9, 0.8));
  interior.add(new THREE.Mesh(mergeGeometries(fit.map((g) => g.toNonIndexed())), fittings));

  // Durum LED'leri (röle, pompa) ve düğme sıraları: kendinden ışıklı
  const ledRelay = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  const ledPump = new THREE.MeshBasicMaterial({ color: 0x401008 });
  interior.add(new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6).translate(TARGETS.relay.x + 0.06, TARGETS.relay.y + 0.18, TARGETS.relay.z), ledRelay));
  interior.add(new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6).translate(TARGETS.pump.x - 0.06, TARGETS.pump.y + 0.15, TARGETS.pump.z), ledPump));
  const buttons: THREE.BufferGeometry[] = [];
  // Konsolun eğik üst yüzünün ön kenarı boyunca (yüzeye oturur)
  for (let k = 0; k < 10; k++) buttons.push(new THREE.BoxGeometry(0.05, 0.02, 0.04).rotateX(-0.5).translate(-0.85 + k * 0.06, -0.255, -0.71));
  for (let k = 0; k < 6; k++) buttons.push(new THREE.BoxGeometry(0.05, 0.02, 0.04).rotateX(-0.5).translate(0.52 + k * 0.06, -0.255, -0.71));
  interior.add(new THREE.Mesh(mergeGeometries(buttons), new THREE.MeshBasicMaterial({ color: 0x3ad0c0 })));

  // Ekranlar: sonar (sol) ve durum (sağ), konsolun üstünde koltuğa dönük
  const sonar = screenCanvas(256, 192);
  const stat = screenCanvas(256, 192);
  const screenGeo = (x: number) => new THREE.PlaneGeometry(0.5, 0.36).rotateX(-0.45).translate(x, -0.12, -0.86);
  interior.add(new THREE.Mesh(screenGeo(-0.32), new THREE.MeshBasicMaterial({ map: sonar.tex, toneMapped: false })));
  interior.add(new THREE.Mesh(screenGeo(0.32), new THREE.MeshBasicMaterial({ map: stat.tex, toneMapped: false })));

  const status: MurenStatus = { depth: 186, o2: 100, power: 100, ballast: 'ok', sonar: 'idle', alarm: false, relayOk: false, pumpOk: false };
  let phase: MurenPhase = 'descent';
  let phaseT = 0;
  let impact = false;
  let drawT = 0;
  const pose = { x: 0, y: 0, z: 0, yaw: wreck.yaw, pitch: 0, roll: 0 };
  const dir = { x: -Math.sin(wreck.yaw), z: -Math.cos(wreck.yaw) };
  // İniş: enkaz noktasının 12 m gerisinden ve 15 m yukarıdan, istasyona doğru süzülerek
  const start = { x: wreck.x - dir.x * 12, y: wreck.y + 15, z: wreck.z - dir.z * 12 };
  const hover = { x: wreck.x - dir.x * 3, y: wreck.y + 6.5, z: wreck.z - dir.z * 3 };
  let sinkFrom = { ...hover };
  const ease = (k: number) => k * k * (3 - 2 * k);

  const place = () => {
    root.position.set(pose.x, pose.y, pose.z);
    root.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
    root.updateMatrixWorld(true);
  };
  const setWreck = () => Object.assign(pose, { x: wreck.x, y: wreck.y, z: wreck.z, yaw: wreck.yaw + 0.12, pitch: -0.05, roll: 0.13 });
  setWreck();
  place();

  const drawSonar = (time: number) => {
    const { g, c } = sonar;
    g.fillStyle = '#021014';
    g.fillRect(0, 0, c.width, c.height);
    const cx = 128;
    const cy = 100;
    g.strokeStyle = 'rgba(80,220,200,0.35)';
    for (const r of [30, 60, 88]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    const a = (time * 1.4) % (Math.PI * 2);
    g.strokeStyle = 'rgba(120,255,220,0.9)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 88, cy + Math.sin(a) * 88);
    g.stroke();
    g.fillStyle = 'rgba(120,255,220,0.8)';
    for (const [bx, by] of [[40, -20], [-50, 30], [22, 55]]) g.fillRect(cx + bx, cy + by, 3, 3);
    if (status.sonar === 'contact') {
      g.fillStyle = `rgba(255,90,70,${0.5 + 0.5 * Math.sin(time * 10)})`;
      g.beginPath();
      g.ellipse(cx - 58, cy - 40, 26, 9, -0.4, 0, Math.PI * 2);
      g.fill();
    }
    g.font = 'bold 15px monospace';
    g.fillStyle = status.sonar === 'beacon' ? '#ffb030' : '#7fe8d8';
    g.fillText(status.sonar === 'beacon' ? 'NRS-BCN 121,5 kHz' : status.sonar === 'contact' ? 'TEMAS: BELİRSİZ' : 'SONAR', 10, 20);
  };
  const drawStat = (time: number) => {
    const { g, c } = stat;
    g.fillStyle = status.alarm && Math.sin(time * 8) > 0 ? '#2a0606' : '#021014';
    g.fillRect(0, 0, c.width, c.height);
    g.font = 'bold 22px monospace';
    g.fillStyle = status.alarm ? '#ff5040' : '#7fe8d8';
    g.fillText(`DERİNLİK ${Math.round(status.depth)} m`, 10, 30);
    const bar = (label: string, v: number, y: number) => {
      g.font = '15px monospace';
      g.fillStyle = '#9bb';
      g.fillText(label, 10, y + 12);
      g.fillStyle = '#0d2a31';
      g.fillRect(60, y, 180, 14);
      g.fillStyle = v < 25 ? '#ff5040' : v < 50 ? '#ffb030' : '#3ad0c0';
      g.fillRect(60, y, 1.8 * Math.max(0, Math.min(100, v)), 14);
    };
    bar('O₂', status.o2, 50);
    bar('GÜÇ', status.power, 76);
    g.font = '15px monospace';
    g.fillStyle = status.ballast === 'ok' ? '#7fe8d8' : '#ff5040';
    g.fillText(`BALAST: ${status.ballast === 'ok' ? 'NORMAL' : status.ballast === 'none' ? 'YANIT YOK' : 'KOMUT RED'}`, 10, 122);
    g.fillStyle = status.relayOk ? '#40ff80' : '#ffb030';
    g.fillText(`RÖLE: ${status.relayOk ? 'BAĞLI' : 'TEST BEKLİYOR'}`, 10, 146);
    if (status.alarm) {
      g.fillStyle = '#ff5040';
      g.fillText('TASARIM DERİNLİĞİ AŞILDI', 10, 176);
    }
  };

  const api: Muren = {
    root,
    interior,
    seat: (out) => out.copy(SEAT).applyMatrix4(root.matrixWorld),
    heading: () => pose.yaw,
    target: (t, out) => out.copy(TARGETS[t]).applyMatrix4(root.matrixWorld),
    get phase() {
      return phase;
    },
    setPhase(p) {
      phase = p;
      phaseT = 0;
      if (p === 'descent') Object.assign(pose, { ...start, yaw: wreck.yaw, pitch: 0, roll: 0 });
      if (p === 'sink') sinkFrom = { x: pose.x, y: pose.y, z: pose.z };
      if (p === 'wreck') setWreck();
      place();
    },
    takeImpact() {
      const was = impact;
      impact = false;
      return was;
    },
    status,
    update(dt, time) {
      phaseT += dt;
      if (phase === 'descent') {
        // ~3,5 dakikada süzülme noktasına; sonra yerinde hafif salınım
        const k = ease(Math.min(1, phaseT / 210));
        pose.x = THREE.MathUtils.lerp(start.x, hover.x, k);
        pose.y = THREE.MathUtils.lerp(start.y, hover.y, k) + Math.sin(time * 0.5) * 0.08;
        pose.z = THREE.MathUtils.lerp(start.z, hover.z, k);
        pose.roll = Math.sin(time * 0.37) * 0.03;
        pose.pitch = Math.sin(time * 0.29) * 0.02;
        status.depth = 186 + k * 9 + (1 - k) * 0;
      } else if (phase === 'sink') {
        // 8 s: burun aşağı, yalpalayarak tabana
        const k = Math.min(1, phaseT / 8);
        const e = k * k;
        pose.x = THREE.MathUtils.lerp(sinkFrom.x, wreck.x, ease(k));
        pose.z = THREE.MathUtils.lerp(sinkFrom.z, wreck.z, ease(k));
        pose.y = THREE.MathUtils.lerp(sinkFrom.y, wreck.y, e);
        pose.pitch = -0.35 * Math.sin(k * Math.PI);
        pose.roll = Math.sin(phaseT * 2.1) * 0.08 * (1 - k) + 0.13 * k;
        pose.yaw = wreck.yaw + 0.12 * k;
        status.depth = 195 + 26 * e;
        if (k >= 1) {
          phase = 'wreck';
          impact = true;
          setWreck();
        }
      }
      place();
      ledRelay.color.setHex(status.relayOk ? 0x30ff70 : Math.sin(time * 6) > 0 ? 0xff3020 : 0x401008);
      ledPump.color.setHex(status.pumpOk ? 0x30ff70 : status.ballast !== 'ok' ? (Math.sin(time * 6) > 0 ? 0xff3020 : 0x401008) : 0x30ff70);
      lampMat.color.setHex(status.power > 5 ? 0xfff2c0 : 0x202020);
      drawT -= dt;
      if (interior.visible && drawT <= 0) {
        drawT = 0.08;
        drawSonar(time);
        drawStat(time);
        sonar.tex.needsUpdate = true;
        stat.tex.needsUpdate = true;
      }
    },
  };
  return api;
}
