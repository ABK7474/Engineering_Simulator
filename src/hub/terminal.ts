// Arıza terminali: duvar terminali (Prop_AccessPoint) ya da kontrol konsolu (Prop_Computer) üzerinde
// eğik ekran, durum LED'i, yanık izi. Bulmacadan habersiz; yalnız görsel durumları değiştirir.
// LED ışığı tek bir paylaşılan dinamik ışıktır (ışık bütçesi): yalnız etkin terminale taşınır.

import * as THREE from 'three';
import type { TerminalModel } from '../world/schema';
import type { TerminalLayout } from '../world/layout';

export interface Terminal {
  id: string;
  /** Etkileşim mesafesi ve harita bu noktaya göre (ekran merkezi, dünya). */
  panelPosition: THREE.Vector3;
  ledPosition: THREE.Vector3;
  /** Sonuç oynarken kameranın bakacağı nokta. */
  focusPoint: THREE.Vector3;
  setScreen: (text: string, color: string, blink?: boolean) => void;
  /** `light`: paylaşılan dinamik ışığı bu LED'e taşı (sonuç oynarken). */
  setLed: (color: number, intensity: number, light?: boolean) => void;
  burnLed: () => void;
  replaceLed: () => void;
  showScorch: () => void;
  hasScorch: () => boolean;
  update: (dt: number) => void;
}

// Modellerin eğik ekranları (model koordinatlarında, glTF'ten ölçülerek bulundu): ikisi de 45° eğik,
// normal (0, .71, .71); "dir" ekranın alt-ön kenarından üst-arka kenarına.
const SCREEN: Record<TerminalModel, { center: THREE.Vector3; size: [number, number]; canvas: [number, number]; offset: number; led: [number, number] }> = {
  Prop_AccessPoint: { center: new THREE.Vector3(0, 1.335, 0.39), size: [0.24, 0.28], canvas: [192, 224], offset: 0.06, led: [-0.15, 0] },
  Prop_Computer: { center: new THREE.Vector3(0, 1.435, 0.075), size: [0.5, 0.3], canvas: [320, 192], offset: 0.04, led: [-0.17, 0.27] },
};
const DIR = new THREE.Vector3(0, 0.707, -0.707);
const NORMAL = new THREE.Vector3(0, 0.707, 0.707);

export function createTerminal(scene: THREE.Scene, t: TerminalLayout, sharedLight: THREE.PointLight): Terminal {
  const spec = SCREEN[t.model];
  const root = new THREE.Group();
  root.position.set(t.x, 0, t.z);
  root.rotation.y = t.rotY;
  scene.add(root);
  // Model sabit nesnelerle instancing ile çizilir; burada yalnız ekran, LED, iz.

  const onScreen = (along: number, lift: number, side = 0) =>
    spec.center.clone().addScaledVector(DIR, along).addScaledVector(NORMAL, lift).add(new THREE.Vector3(side, 0, 0));

  const surface = (w: number, h: number) => {
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [w, h];
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, ctx: canvas.getContext('2d')!, tex };
  };
  const surfaces = [surface(...spec.canvas)];
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(...spec.size), new THREE.MeshBasicMaterial({ map: surfaces[0].tex, fog: false }));
  screen.position.copy(onScreen(spec.offset, 0.006));
  screen.rotation.x = -Math.PI / 4;
  root.add(screen);
  if (t.model === 'Prop_AccessPoint') {
    // Bu modelin ekranı kolun ucunda, duvar boyunca yana bakıyor: önünde duran oyuncu göremez. Gövdenin odaya
    // bakan ön yüzüne (model +x) aynı durumu gösteren yatay bir şerit ekran.
    const front = surface(320, 192);
    surfaces.push(front);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.25), new THREE.MeshBasicMaterial({ map: front.tex, fog: false }));
    strip.position.set(0.226, 1.3, 0.05);
    strip.rotation.y = Math.PI / 2;
    root.add(strip);
  }

  const ledMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x000000, roughness: 0.3 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), ledMat);
  led.position.copy(onScreen(spec.led[0], 0.015, spec.led[1]));
  root.add(led);

  const scorch = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10), new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.75 }));
  scorch.position.copy(onScreen(spec.led[0] + 0.04, 0.008, spec.led[1]));
  scorch.rotation.x = -Math.PI / 4;
  scorch.visible = false;
  root.add(scorch);
  root.updateMatrixWorld(true);

  let state = { text: '', color: '#fff', blink: false };
  let blinkT = 0;
  const draw = (visible: boolean) => {
    for (const { canvas, ctx, tex } of surfaces) {
      ctx.fillStyle = '#020807';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (visible && state.text) {
        ctx.fillStyle = state.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = state.text.split('\n');
        // En uzun satır ekranın %70'ine sığana kadar küçült (kenarları modelin çerçevesi örtüyor).
        let size = 30;
        do ctx.font = `bold ${size}px monospace`;
        while (size-- > 12 && Math.max(...lines.map((l) => ctx.measureText(l).width)) > canvas.width * 0.7);
        lines.forEach((l, k) => ctx.fillText(l, canvas.width / 2, canvas.height / 2 + (k - (lines.length - 1) / 2) * 30));
      }
      tex.needsUpdate = true;
    }
  };

  const ledWorld = root.localToWorld(led.position.clone());
  const lightWorld = root.localToWorld(onScreen(spec.led[0], 0.12, spec.led[1]));
  const screenWorld = root.localToWorld(spec.center.clone());

  const api: Terminal = {
    id: t.fault.id,
    panelPosition: screenWorld,
    ledPosition: ledWorld,
    focusPoint: screenWorld.clone().add(new THREE.Vector3(0, 0.1, 0)),
    setScreen(text, color, blink = false) {
      state = { text, color, blink };
      blinkT = 0;
      draw(true);
    },
    setLed(color, intensity, light = false) {
      ledMat.color.setHex(intensity > 0 ? color : 0x331111);
      ledMat.emissive.setHex(color);
      ledMat.emissiveIntensity = intensity * 2;
      if (light) {
        sharedLight.position.copy(lightWorld);
        sharedLight.color.setHex(color);
        sharedLight.intensity = intensity * 3;
      }
    },
    burnLed() {
      api.setLed(0x000000, 0, true);
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
      if (!state.blink) return;
      const was = Math.floor(blinkT * 2.5) % 2 === 0;
      blinkT += dt;
      const on = Math.floor(blinkT * 2.5) % 2 === 0;
      if (on !== was) draw(on);
    },
  };
  api.replaceLed();
  return api;
}
