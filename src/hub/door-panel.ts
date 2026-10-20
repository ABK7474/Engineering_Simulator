// Bozuk kapı + yanındaki terminal (ekran, durum LED'i, yanık izi). Bulmacadan habersiz:
// yalnızca görsel durumları değiştiren yöntemler sunar. Kapı çerçevesi sabit modüllerle birlikte
// instancing ile çizilir; burada yalnızca hareketli kanatlar ve terminal var.

import * as THREE from 'three';
import { boxProjectUVs, pbrMaterial, type Assets } from './assets';
import type { CorridorLayout } from './layout';

export interface DoorPanel {
  /** Etkileşim mesafesi bu noktaya göre ölçülür. */
  panelPosition: THREE.Vector3;
  /** Sonuç oynarken kameranın bakacağı nokta (panel ile kapı arası). */
  focusPoint: THREE.Vector3;
  ledPosition: THREE.Vector3;
  /** Kapı tamamen açılana kadar geçişi engeller (hub, openAmount'a göre kullanır). */
  collider: THREE.Box3;
  /** 0 = kapalı, 1 = tamamen açık. */
  openAmount: number;
  setScreen: (text: string, color: string, blink?: boolean) => void;
  setLed: (color: number, intensity: number) => void;
  burnLed: () => void;
  replaceLed: () => void;
  showScorch: () => void;
  hasScorch: () => boolean;
  update: (dt: number) => void;
}

const LEAF_TRAVEL = 2.15;

// Prop_AccessPoint'in eğik ekranı (model koordinatlarında, ölçülerek bulundu):
// alt-ön kenar (y 1.18, z 0.55) → üst-arka kenar (y 1.49, z 0.23), normal (0, .71, .71).
const SCREEN_DIR = new THREE.Vector3(0, 0.697, -0.719);
const SCREEN_NORMAL = new THREE.Vector3(0, 0.707, 0.707);
const SCREEN_CENTER = new THREE.Vector3(0, 1.335, 0.39);

export function createDoorPanel(scene: THREE.Scene, assets: Assets, L: CorridorLayout): DoorPanel {
  // --- Kanatlar: Door_Metal geometrisi, kutu izdüşümü UV ile Poly Haven paslı metal ---
  // Model tek yüzlü: odadan bakınca da görünsün diye çift taraflı.
  const rust = pbrMaterial(assets.rustyMetal, new THREE.Vector2(1, 1), { metalness: 0.8, side: THREE.DoubleSide });
  const makeLeaf = () => {
    const leaf = new THREE.Group();
    const src = assets.models.Door_Metal;
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      leaf.add(new THREE.Mesh(boxProjectUVs(geo, 0.5), rust));
    });
    scene.add(leaf);
    return leaf;
  };
  const leftLeaf = makeLeaf();
  const rightLeaf = makeLeaf();
  // Sağ kanat aynalanır (180° döndürmek tek yüzlü modelin arkasını kameraya çevirirdi).
  rightLeaf.scale.x = -1;
  leftLeaf.position.z = rightLeaf.position.z = L.doorZ - 0.05;

  // --- Terminal ---
  const panel = new THREE.Group();
  panel.position.set(L.panel.x, 0, L.panel.z);
  panel.rotation.y = L.panel.rotY;
  panel.add(assets.models.Prop_AccessPoint.clone());
  scene.add(panel);

  const onScreen = (along: number, lift: number) =>
    SCREEN_CENTER.clone().addScaledVector(SCREEN_DIR, along).addScaledVector(SCREEN_NORMAL, lift);

  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 224;
  const ctx = canvas.getContext('2d')!;
  const screenTex = new THREE.CanvasTexture(canvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.28), new THREE.MeshBasicMaterial({ map: screenTex, fog: false }));
  screen.position.copy(onScreen(0.06, 0.006));
  screen.rotation.x = -Math.PI / 4;
  panel.add(screen);

  const ledMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x000000, roughness: 0.3 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), ledMat);
  led.position.copy(onScreen(-0.15, 0.015));
  panel.add(led);
  const ledLight = new THREE.PointLight(0xffffff, 0, 3, 2);
  ledLight.position.copy(onScreen(-0.15, 0.12));
  panel.add(ledLight);

  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 10),
    new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.75 }),
  );
  scorch.position.copy(onScreen(-0.11, 0.008));
  scorch.rotation.x = -Math.PI / 4;
  scorch.visible = false;
  panel.add(scorch);

  panel.updateMatrixWorld(true);

  let screenState = { text: '', color: '#fff', blink: false };
  let blinkT = 0;
  const drawScreen = (visible: boolean) => {
    ctx.fillStyle = '#020807';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (visible && screenState.text) {
      ctx.fillStyle = screenState.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = screenState.text.split('\n');
      // En uzun satır ekranın %88'ine sığana kadar yazıyı küçült.
      let size = 30;
      do ctx.font = `bold ${size}px monospace`;
      while (size-- > 12 && Math.max(...lines.map((l) => ctx.measureText(l).width)) > canvas.width * 0.88);
      lines.forEach((l, k) => ctx.fillText(l, canvas.width / 2, canvas.height / 2 + (k - (lines.length - 1) / 2) * 30));
    }
    screenTex.needsUpdate = true;
  };

  const collider = new THREE.Box3(new THREE.Vector3(-2, -1, L.doorZ - 0.15), new THREE.Vector3(2, 6, L.doorZ + 0.15));

  const api: DoorPanel = {
    panelPosition: panel.localToWorld(SCREEN_CENTER.clone()),
    focusPoint: new THREE.Vector3(L.panel.x * 0.4, 1.5, L.doorZ + 1.2),
    ledPosition: panel.localToWorld(led.position.clone()),
    collider,
    openAmount: 0,
    setScreen(text, color, blink = false) {
      screenState = { text, color, blink };
      blinkT = 0;
      drawScreen(true);
    },
    setLed(color, intensity) {
      ledMat.color.setHex(intensity > 0 ? color : 0x331111);
      ledMat.emissive.setHex(color);
      ledMat.emissiveIntensity = intensity * 2;
      ledLight.color.setHex(color);
      ledLight.intensity = intensity * 3;
    },
    burnLed() {
      api.setLed(0x000000, 0);
      ledMat.color.setHex(0x0a0a0a);
    },
    replaceLed() {
      api.setLed(0x000000, 0);
    },
    showScorch() {
      scorch.visible = true;
    },
    hasScorch: () => scorch.visible,
    update(dt) {
      leftLeaf.position.x = -api.openAmount * LEAF_TRAVEL;
      rightLeaf.position.x = api.openAmount * LEAF_TRAVEL;
      if (screenState.blink) {
        const was = Math.floor(blinkT * 2.5) % 2 === 0;
        blinkT += dt;
        const on = Math.floor(blinkT * 2.5) % 2 === 0;
        if (on !== was) drawScreen(on);
      }
    },
  };
  api.replaceLed();
  return api;
}
