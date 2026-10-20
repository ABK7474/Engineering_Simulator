// Bozuk kapı + yanındaki kontrol paneli (ekran, durum LED'i, yanık izi). Bulmacadan habersiz:
// yalnızca görsel durumları değiştiren yöntemler sunar.

import * as THREE from 'three';
import { LAYOUT } from './corridor';

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
  update: (dt: number) => void;
}

export function createDoorPanel(scene: THREE.Scene): DoorPanel {
  const { doorZ, doorHalfWidth: dw, doorHeight: dh, halfWidth: hw } = LAYOUT;

  // Kapı kanatları (hareketli → gölge düşürmez; sabit gölge haritasını bozmasın)
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5b6a70, flatShading: true, metalness: 0.7, roughness: 0.4 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, emissive: 0x2a1c00 });
  const leaves = [-1, 1].map((side) => {
    const leaf = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.12), leafMat);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, dh, 0.13), stripeMat);
    stripe.position.x = -side * (dw / 2 - 0.03);
    leaf.add(body, stripe);
    leaf.position.set((side * dw) / 2, dh / 2, doorZ);
    scene.add(leaf);
    return { leaf, side };
  });

  // Panel gövdesi sağ duvarda, koridora bakıyor (-x yönü)
  const panelPos = new THREE.Vector3(hw - 0.04, 1.35, doorZ + 1.3);
  const panel = new THREE.Group();
  panel.position.copy(panelPos);
  panel.rotation.y = -Math.PI / 2;
  scene.add(panel);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.7, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x46545a, flatShading: true, metalness: 0.4 }),
  );
  body.receiveShadow = true;
  panel.add(body);

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const screenTex = new THREE.CanvasTexture(canvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.22), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(0, 0.17, 0.031);
  panel.add(screen);

  const ledMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x000000, roughness: 0.3 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), ledMat);
  led.position.set(0, -0.12, 0.04);
  panel.add(led);
  const ledLight = new THREE.PointLight(0xffffff, 0, 3, 2);
  ledLight.position.set(0, -0.12, 0.12);
  panel.add(ledLight);

  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 10),
    new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.75 }),
  );
  scorch.position.set(0.06, -0.12, 0.032);
  scorch.visible = false;
  panel.add(scorch);

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
      ctx.font = `bold ${lines.length > 1 ? 26 : 32}px monospace`;
      lines.forEach((l, k) => ctx.fillText(l, 128, 64 + (k - (lines.length - 1) / 2) * 34));
    }
    screenTex.needsUpdate = true;
  };

  panel.updateMatrixWorld();
  const collider = new THREE.Box3(new THREE.Vector3(-dw, -1, doorZ - 0.1), new THREE.Vector3(dw, 5, doorZ + 0.1));

  const api: DoorPanel = {
    panelPosition: panelPos.clone(),
    focusPoint: new THREE.Vector3(hw * 0.45, 1.3, doorZ + 0.7),
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
    update(dt) {
      for (const { leaf, side } of leaves) leaf.position.x = side * (dw / 2 + api.openAmount * (dw + 0.05));
      if (screenState.blink) {
        blinkT += dt;
        const on = Math.floor(blinkT * 2.5) % 2 === 0;
        if (on !== ((Math.floor((blinkT - dt) * 2.5) % 2) === 0)) drawScreen(on);
      }
    },
  };
  api.replaceLed();
  return api;
}
