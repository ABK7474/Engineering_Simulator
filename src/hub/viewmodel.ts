// Oyuncunun kolları (birinci şahıs): kodla kurulan kıyafet kolu, eldiven, sol bilekte cihaz (tuval ekran), tabanda
// sağ elde fener. Ayrı küçük bir sahnede, kameranın uzayında ve derinlik temizlenerek ikinci geçişte çizilir: duvara
// girmez, ana sahnenin ışık sayısına dokunmaz. Bilek ekranı: kaynaklar, hedef, temas sayacı, tekrar; ya da harita.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArmPose } from './arm-state';

export interface WristRow {
  label: string;
  value: number;
  max: number;
  level: 'ok' | 'low' | 'critical';
}

export interface WristInfo {
  rows: WristRow[];
  goal?: string;
  threat?: { remaining: number; noise: 0 | 1 | 2 } | null;
  reviewDue?: number;
  /** Onarılmamış hasarlar (kısa). */
  damages?: string[];
}

export interface WristMap {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  rooms: { name: string; rect: { minX: number; maxX: number; minZ: number; maxZ: number }; current: boolean }[];
  doors: { x: number; z: number; horizontal: boolean; open: boolean }[];
  faults: { x: number; z: number; status: 'open' | 'blocked' | 'solved'; target: boolean }[];
  player: { x: number; z: number; yaw: number } | null;
  targetLabel?: string;
}

export interface Viewmodel {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setInfo: (i: WristInfo) => void;
  setMap: (m: WristMap | null) => void;
  /** Bilek ekranının sayfası. */
  setPage: (p: 'status' | 'map') => void;
  /** Tabanda sağ elde fener. */
  setTorch: (on: boolean) => void;
  setVisible: (on: boolean) => void;
  update: (pose: ArmPose, time: number) => void;
}

const SLEEVE = 0xc9a24a; // kıyafet (Müren sarısı)
const GLOVE = 0x2b3236;

function armGeometry(): { sleeve: THREE.BufferGeometry; glove: THREE.BufferGeometry } {
  // Bilek orijinde; ön kol +z (dirseğe), el −z (ileri)
  const sleeve = mergeGeometries([
    new THREE.CylinderGeometry(0.047, 0.058, 0.34, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.19),
    new THREE.TorusGeometry(0.05, 0.012, 6, 14).translate(0, 0, 0.02),
  ].map((g) => g.toNonIndexed()));
  const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.085, 0.032, 0.1).translate(0, 0, -0.06)];
  for (let k = 0; k < 4; k++) {
    const x = -0.03 + k * 0.02;
    const len = [0.06, 0.07, 0.068, 0.055][k];
    parts.push(new THREE.BoxGeometry(0.017, 0.019, len).rotateX(-0.25).translate(x, -0.006, -0.11 - len / 2));
  }
  parts.push(new THREE.BoxGeometry(0.018, 0.02, 0.055).rotateY(-0.6).translate(0.05, -0.008, -0.07));
  const glove = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  return { sleeve, glove };
}

/** Yerel +y'nin `up` yönüne, yerel +z'nin (ona dik kalacak şekilde) `back` yönüne baktığı dönüş. */
function basis(up: [number, number, number], back: [number, number, number]): THREE.Quaternion {
  const y = new THREE.Vector3(...up).normalize();
  const z = new THREE.Vector3(...back);
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function buildViewmodel(aspect: number): Viewmodel {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, aspect, 0.01, 3);
  scene.add(new THREE.HemisphereLight(0xbfe6ee, 0x203038, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(0.4, 1, 0.6);
  scene.add(key);

  const { sleeve, glove } = armGeometry();
  const sleeveMat = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.7, metalness: 0.1 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.85, metalness: 0.05 });
  const makeArm = (mirror: boolean) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(sleeve, sleeveMat), new THREE.Mesh(glove, gloveMat));
    if (mirror) g.scale.x = -1;
    scene.add(g);
    return g;
  };
  const left = makeArm(true);
  const right = makeArm(false);

  // Bilek cihazı: sol kolun üstünde gövde + ekran (+y yüzü)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.026, 0.07).translate(0, 0.05, 0.075), new THREE.MeshStandardMaterial({ color: 0x1c2427, roughness: 0.5, metalness: 0.6 }));
  left.add(body);
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 256;
  const g2 = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.056).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(0, 0.0635, 0.075), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  // Sol kol aynalı: ekranın yazısı ters dönmesin diye ekran aynanın etkisini geri alır
  screen.scale.x = -1;
  left.add(screen);

  // Fener (sağ elde, tabanda)
  const torch = new THREE.Mesh(
    mergeGeometries([new THREE.CylinderGeometry(0.018, 0.018, 0.16, 10).rotateX(Math.PI / 2).translate(0, -0.01, -0.07), new THREE.CylinderGeometry(0.026, 0.02, 0.04, 10).rotateX(Math.PI / 2).translate(0, -0.01, -0.165)].map((g) => g.toNonIndexed())),
    new THREE.MeshStandardMaterial({ color: 0x30383b, roughness: 0.4, metalness: 0.7, emissive: 0x000000 }),
  );
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12).rotateY(Math.PI).translate(0, -0.01, -0.187), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
  const torchGroup = new THREE.Group();
  torchGroup.add(torch, lens);
  torchGroup.visible = false;
  right.add(torchGroup);

  let info: WristInfo = { rows: [] };
  let map: WristMap | null = null;
  let page: 'status' | 'map' = 'status';
  let drawAt = 0;

  const drawStatus = (time: number) => {
    const W = canvas.width;
    const H = canvas.height;
    const alert = info.rows.some((r) => r.level !== 'ok') || Boolean(info.threat);
    g2.fillStyle = '#031418';
    g2.fillRect(0, 0, W, H);
    if (alert && Math.sin(time * 6) > 0) {
      g2.strokeStyle = '#ff5040';
      g2.lineWidth = 10;
      g2.strokeRect(5, 5, W - 10, H - 10);
    }
    let y = 34;
    for (const r of info.rows) {
      g2.font = 'bold 26px monospace';
      g2.fillStyle = '#8fb8bc';
      g2.fillText(r.label, 18, y + 18);
      g2.fillStyle = '#0d2a31';
      g2.fillRect(84, y, 150, 22);
      g2.fillStyle = r.level === 'critical' ? '#ff5040' : r.level === 'low' ? '#ffb030' : '#3ad0c0';
      g2.fillRect(84, y, 150 * Math.max(0, Math.min(1, r.value / r.max)), 22);
      g2.fillStyle = '#e8f6f6';
      g2.fillText(`${Math.floor(r.value)}`, 246, y + 19);
      y += 40;
    }
    if (info.threat) {
      const t = info.threat;
      g2.font = 'bold 28px monospace';
      g2.fillStyle = Math.sin(time * 5) > 0 ? '#ff5040' : '#a02818';
      g2.fillText(`TEMAS ${Math.floor(t.remaining / 60)}:${String(Math.floor(t.remaining % 60)).padStart(2, '0')}`, 18, y + 24);
      g2.font = '20px monospace';
      g2.fillStyle = '#ffb030';
      g2.fillText(`ses ${'●'.repeat(t.noise)}${'○'.repeat(2 - t.noise)}`, 210, y + 22);
      y += 40;
    }
    if (info.goal) {
      g2.font = '19px sans-serif';
      g2.fillStyle = '#3ad0c0';
      g2.fillText('HEDEF', 18, y + 18);
      g2.fillStyle = '#d8eef0';
      // Kelime kaydırma (en fazla iki satır)
      const words = info.goal.split(' ');
      let line = '';
      let row = 0;
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (g2.measureText(next).width > W - 36 && line) {
          g2.fillText(line, 18, y + 42 + row * 22);
          line = w;
          if (++row >= 2) break;
        } else line = next;
      }
      if (row < 2 && line) g2.fillText(line, 18, y + 42 + row * 22);
      y += 86;
    }
    if (info.reviewDue) {
      g2.font = '18px sans-serif';
      g2.fillStyle = '#ffb030';
      g2.fillText(`Tekrar: ${info.reviewDue} konu (N)`, 18, Math.min(H - 14, y + 10));
    }
  };

  const drawMap = () => {
    const W = canvas.width;
    const H = canvas.height;
    g2.fillStyle = '#031418';
    g2.fillRect(0, 0, W, H);
    if (!map) return;
    const b = map.bounds;
    const pad = 2;
    const s = Math.min((W - 16) / (b.maxX - b.minX + 2 * pad), (H - 40) / (b.maxZ - b.minZ + 2 * pad));
    const ox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s;
    const oz = 8 + pad * s - b.minZ * s;
    const X = (x: number) => ox + x * s;
    const Z = (z: number) => oz + z * s;
    for (const r of map.rooms) {
      g2.fillStyle = r.current ? '#13424d' : '#0d2f37';
      g2.strokeStyle = r.current ? '#3ad0c0' : '#5fa9b3';
      g2.lineWidth = 2;
      g2.fillRect(X(r.rect.minX), Z(r.rect.minZ), (r.rect.maxX - r.rect.minX) * s, (r.rect.maxZ - r.rect.minZ) * s);
      g2.strokeRect(X(r.rect.minX), Z(r.rect.minZ), (r.rect.maxX - r.rect.minX) * s, (r.rect.maxZ - r.rect.minZ) * s);
    }
    g2.lineWidth = 4;
    for (const d of map.doors) {
      g2.strokeStyle = d.open ? '#30c070' : '#ff5040';
      g2.beginPath();
      if (d.horizontal) {
        g2.moveTo(X(d.x - 1.6), Z(d.z));
        g2.lineTo(X(d.x + 1.6), Z(d.z));
      } else {
        g2.moveTo(X(d.x), Z(d.z - 1.6));
        g2.lineTo(X(d.x), Z(d.z + 1.6));
      }
      g2.stroke();
    }
    for (const f of map.faults) {
      g2.fillStyle = f.status === 'solved' ? '#30c070' : f.status === 'blocked' ? '#8aa0a4' : '#ffb030';
      g2.beginPath();
      g2.arc(X(f.x), Z(f.z), f.target ? 7 : 5, 0, Math.PI * 2);
      g2.fill();
      if (f.target) {
        g2.strokeStyle = '#ffb030';
        g2.lineWidth = 2;
        g2.beginPath();
        g2.arc(X(f.x), Z(f.z), 12, 0, Math.PI * 2);
        g2.stroke();
      }
    }
    const p = map.player;
    if (p) {
      g2.save();
      g2.translate(X(p.x), Z(p.z));
      g2.rotate(-p.yaw);
      g2.fillStyle = '#e8f6f6';
      g2.beginPath();
      g2.moveTo(0, -11);
      g2.lineTo(6, 5);
      g2.lineTo(-6, 5);
      g2.closePath();
      g2.fill();
      g2.restore();
    }
    if (map.targetLabel) {
      g2.font = '17px sans-serif';
      g2.fillStyle = '#ffb030';
      g2.fillText(`Hedef: ${map.targetLabel}`, 10, H - 10);
    }
  };

  // Kol konumları (kameranın uzayında). Sol kolun yönü iki eksenle verilir: ekranın baktığı yön (yerel +y) ve
  // dirseğin yönü (yerel +z). Dinlenme: ekran yukarı-geri, kol sol alttan; kaldırılmış: saate bakar gibi ön kol
  // yatay (dirsek solda), ekran oyuncuya dönük.
  const L_REST = { p: new THREE.Vector3(-0.17, -0.225, -0.38), q: basis([0.2, 0.7, 0.7], [-0.75, -0.5, 0.35]) };
  const L_UP = { p: new THREE.Vector3(-0.05, -0.12, -0.3), q: basis([0, 0.3, 1], [-1, -0.25, 0]) };
  const R_REST = { p: new THREE.Vector3(0.3, -0.52, -0.36), r: new THREE.Euler(-0.15, -0.2, -0.3) };
  const R_REACH = { p: new THREE.Vector3(0.11, -0.16, -0.62), r: new THREE.Euler(0.05, -0.05, -0.15) };
  const R_TORCH = { p: new THREE.Vector3(0.22, -0.27, -0.46), r: new THREE.Euler(0.05, -0.02, -0.25) };
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  let torchOn = false;

  return {
    scene,
    camera,
    setInfo(i) {
      info = i;
    },
    setMap(m) {
      map = m;
    },
    setPage(p) {
      page = p;
      drawAt = 0;
    },
    setTorch(on) {
      torchOn = on;
      torchGroup.visible = on;
    },
    setVisible(on) {
      left.visible = right.visible = on;
    },
    update(pose, time) {
      left.position.lerpVectors(L_REST.p, L_UP.p, pose.raise).add(new THREE.Vector3(pose.bobX, -pose.bobY, 0));
      left.quaternion.slerpQuaternions(L_REST.q, L_UP.q, pose.raise);
      const base = torchOn ? R_TORCH : R_REST;
      right.position.lerpVectors(base.p, R_REACH.p, pose.reach).add(new THREE.Vector3(-pose.bobX, -pose.bobY * 0.8, 0));
      right.quaternion.slerpQuaternions(qa.setFromEuler(base.r), qb.setFromEuler(R_REACH.r), pose.reach);
      if (time >= drawAt) {
        drawAt = time + (page === 'map' ? 0.2 : 0.12);
        if (page === 'map') drawMap();
        else drawStatus(time);
        tex.needsUpdate = true;
      }
    },
  };
}
