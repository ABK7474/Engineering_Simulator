// Renderer, kamera, su altı sisi. Gölge haritası sabit: yüklemede bir kez çizilir.

import * as THREE from 'three';

export const WATER_COLOR = 0x05222a;

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Sabit nesneler sahneye eklendikten sonra çağrılır; gölgeyi bir kez hesaplatır. */
  bakeShadows: () => void;
}

export function createSceneKit(container: HTMLElement): SceneKit {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(WATER_COLOR);
  scene.fog = new THREE.FogExp2(WATER_COLOR, 0.055);

  const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.05, 40);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return {
    renderer,
    scene,
    camera,
    bakeShadows: () => {
      renderer.shadowMap.needsUpdate = true;
    },
  };
}
