// Birinci şahıs hareket: PointerLock + WASD, W'ye çift dokunuşla koşma, C ile eğilme (aç/kapa).
// XZ düzleminde daire-kutu çarpışması; kutunun yüksekliği gövdeden yüksekse altından geçilir.
// Ctrl kullanılmaz (Ctrl+W sekmeyi kapatır).

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { BODY, blocksBody, canStand, createSprint, EYE, moveMode, speedFor, type MoveMode } from './movement';

const RADIUS = 0.3;
/** Göz yüksekliğinin hedefe yaklaşma hızı (1/s). */
const EYE_RATE = 10;

export interface Player {
  controls: PointerLockControls;
  /** Hareket girdisi kapalıyken tuşlar yok sayılır (2D panel açıkken). */
  enabled: boolean;
  /** Bu kare yatayda kaç metre yürüdüğü ve hareket kipi (adım sesi, gürültü). */
  update: (dt: number, colliders: readonly THREE.Box3[]) => { distance: number; mode: MoveMode };
  /** Son karedeki hareket kipi. */
  readonly mode: MoveMode;
  readonly crouched: boolean;
  position: THREE.Vector3;
}

export function createPlayer(camera: THREE.PerspectiveCamera, dom: HTMLElement, start: THREE.Vector3): Player {
  const controls = new PointerLockControls(camera, dom);
  camera.position.set(start.x, EYE.stand, start.z);
  camera.rotation.set(0, 0, 0);

  const keys = new Set<string>();
  let crouched = false;
  let mode: MoveMode = 'idle';
  let lastColliders: readonly THREE.Box3[] = [];

  const sprint = createSprint();
  const isForward = (code: string) => code === 'KeyW' || code === 'ArrowUp';
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (isForward(e.code) && player.enabled && controls.isLocked) sprint.forwardDown(e.timeStamp, e.repeat);
    if (e.code === 'KeyC' && !e.repeat && player.enabled && controls.isLocked) {
      // Aç/kapa. Başın üstünde engel varsa (ör. terminalin altı) ayağa kalkılmaz.
      if (!crouched) {
        crouched = true;
        sprint.cancel();
      } else if (canStand(camera.position.x, camera.position.z, RADIUS, lastColliders)) crouched = false;
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (isForward(e.code) && !keys.has('KeyW') && !keys.has('ArrowUp')) sprint.forwardUp();
  });
  window.addEventListener('blur', () => {
    keys.clear();
    sprint.cancel();
  });

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();

  const player: Player = {
    controls,
    enabled: true,
    position: camera.position,
    get mode() {
      return mode;
    },
    get crouched() {
      return crouched;
    },
    update(dt, colliders) {
      lastColliders = colliders;
      // Göz yüksekliği eğilme durumuna yumuşakça gelir
      const eye = crouched ? EYE.crouch : EYE.stand;
      camera.position.y += (eye - camera.position.y) * Math.min(1, EYE_RATE * dt);

      if (!player.enabled || !controls.isLocked) {
        sprint.cancel(); // panel açılınca ya da imleç bırakılınca koşu biter
        mode = 'idle';
        return { distance: 0, mode };
      }
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      mode = moveMode({ moving: f !== 0 || s !== 0, run: sprint.sprinting && f > 0, crouched });
      if (mode === 'idle') return { distance: 0, mode };

      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, camera.up).normalize();
      move.copy(forward).multiplyScalar(f).addScaledVector(right, s).normalize().multiplyScalar(speedFor(mode) * dt);

      // Eksen eksen ilerle: duvara çapraz yürürken kayarak devam eder.
      const body = crouched ? BODY.crouch : BODY.stand;
      const x0 = camera.position.x;
      const z0 = camera.position.z;
      camera.position.x += move.x;
      resolve(camera.position, colliders, body);
      camera.position.z += move.z;
      resolve(camera.position, colliders, body);
      return { distance: Math.hypot(camera.position.x - x0, camera.position.z - z0), mode };
    },
  };
  return player;
}

function resolve(p: THREE.Vector3, colliders: readonly THREE.Box3[], bodyHeight: number): void {
  for (const b of colliders) {
    if (!blocksBody(b, bodyHeight)) continue; // altından geçilebilir
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
