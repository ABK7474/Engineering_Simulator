// Birinci şahıs yürüyüş: PointerLock + WASD, XZ düzleminde daire-kutu çarpışması.

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

const EYE_HEIGHT = 1.6;
const RADIUS = 0.3;
const SPEED = 2.8;

export interface Player {
  controls: PointerLockControls;
  /** Hareket girdisi kapalıyken tuşlar yok sayılır (2D panel açıkken). */
  enabled: boolean;
  update: (dt: number, colliders: readonly THREE.Box3[]) => void;
  position: THREE.Vector3;
}

export function createPlayer(camera: THREE.PerspectiveCamera, dom: HTMLElement, start: THREE.Vector3): Player {
  const controls = new PointerLockControls(camera, dom);
  camera.position.set(start.x, EYE_HEIGHT, start.z);
  camera.rotation.set(0, 0, 0);

  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();

  const player: Player = {
    controls,
    enabled: true,
    position: camera.position,
    update(dt, colliders) {
      if (!player.enabled || !controls.isLocked) return;
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      if (f === 0 && s === 0) return;

      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, camera.up).normalize();
      move.copy(forward).multiplyScalar(f).addScaledVector(right, s).normalize().multiplyScalar(SPEED * dt);

      // Eksen eksen ilerle: duvara çapraz yürürken kayarak devam eder.
      camera.position.x += move.x;
      resolve(camera.position, colliders);
      camera.position.z += move.z;
      resolve(camera.position, colliders);
    },
  };
  return player;
}

function resolve(p: THREE.Vector3, colliders: readonly THREE.Box3[]): void {
  for (const b of colliders) {
    const cx = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x);
    const cz = THREE.MathUtils.clamp(p.z, b.min.z, b.max.z);
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= RADIUS * RADIUS) continue;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (RADIUS - d);
      p.z += (dz / d) * (RADIUS - d);
    } else {
      // Merkez kutunun içinde: en kısa eksenden dışarı it.
      const pushes = [
        { ax: 'x' as const, v: b.min.x - RADIUS - p.x },
        { ax: 'x' as const, v: b.max.x + RADIUS - p.x },
        { ax: 'z' as const, v: b.min.z - RADIUS - p.z },
        { ax: 'z' as const, v: b.max.z + RADIUS - p.z },
      ].sort((a, c) => Math.abs(a.v) - Math.abs(c.v));
      p[pushes[0].ax] += pushes[0].v;
    }
  }
}
