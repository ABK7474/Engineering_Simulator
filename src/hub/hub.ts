// Hub cephesi: sahneyi kurar, gezinmeyi ve etkileşimi yönetir, Outcome'u görsel efekte çevirir.
// Bulmaca mantığını bilmez; yalnızca core/types Outcome'unu okur.

import * as THREE from 'three';
import type { Outcome } from '../core/types';
import { buildCorridor, LAYOUT } from './corridor';
import { createDoorPanel } from './door-panel';
import { Effects, Tweens } from './effects';
import { createPlayer } from './player';
import { createSceneKit } from './scene';

export interface HubOptions {
  onInteract: () => void;
}

export interface Hub {
  /** Girdiyi kapatır, imleci serbest bırakır (2D panel açılırken). */
  suspend: () => void;
  /** Girdiyi açar; oyuncu tıklayınca yürümeye devam eder. */
  resume: () => void;
  /** Sonucu sahnede oynatır; izlenebilir kısım bitince çözülür. */
  applyOutcome: (o: Outcome) => Promise<void>;
  /** Başarısızlık sonrası yedek parça: ışıklar, LED, kapı eski hâline (yanık izi kalır). */
  repairForRetry: () => void;
}

const INTERACT_RANGE = 1.8;
const FAULT_SCREEN = ['KİLİT ARIZASI\nPANELİ ONAR', '#ff5040'] as const;

export function createHub(container: HTMLElement, opts: HubOptions): Hub {
  const kit = createSceneKit(container);
  const { scene, camera, renderer } = kit;
  const corridor = buildCorridor(scene);
  const door = createDoorPanel(scene);
  const effects = new Effects(scene, new THREE.Vector3(0, LAYOUT.height - 0.2, LAYOUT.doorZ + 0.5));
  const tweens = new Tweens();
  const player = createPlayer(camera, renderer.domElement, new THREE.Vector3(0, 0, 4));
  kit.bakeShadows();

  door.setScreen(FAULT_SCREEN[0], FAULT_SCREEN[1], true);

  let active = true; // false: 2D panel ya da sonuç oynatımı sürüyor
  let solved = false;
  let ledFlicker: { color: number; lo: number; hi: number } | null = null;

  // --- DOM: başlangıç/devam katmanı ve etkileşim ipucu ---
  const gate = document.createElement('div');
  gate.className = 'gate';
  gate.innerHTML = `<div><h1>Derin Mühendis</h1><p>Tıkla ve başla</p>
    <p class="keys">WASD / oklar: yürü · Fare: bak · E: etkileşim · Esc: imleci bırak</p></div>`;
  container.appendChild(gate);
  gate.addEventListener('click', () => player.controls.lock());

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'E: Paneli aç';
  container.appendChild(hint);

  const crosshair = document.createElement('div');
  crosshair.className = 'crosshair';
  container.appendChild(crosshair);

  // PointerLockControls 'lock' olayını isLocked güncellenmeden önce yayınlar; durumu olaydan izle.
  let locked = false;
  const refreshGate = () => {
    gate.style.display = active && !locked ? 'flex' : 'none';
    crosshair.style.display = locked ? 'block' : 'none';
  };
  player.controls.addEventListener('lock', () => {
    locked = true;
    refreshGate();
  });
  player.controls.addEventListener('unlock', () => {
    locked = false;
    refreshGate();
  });

  let nearPanel = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && active && nearPanel && locked) opts.onInteract();
  });

  // --- Döngü ---
  const timer = new THREE.Timer();
  timer.connect(document);
  const tmp = new THREE.Vector2();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    const colliders = door.openAmount > 0.95 ? corridor.colliders : [...corridor.colliders, door.collider];
    player.update(dt, colliders);

    nearPanel =
      !solved &&
      tmp.set(camera.position.x - door.panelPosition.x, camera.position.z - door.panelPosition.z).length() < INTERACT_RANGE;
    hint.style.display = active && nearPanel && locked ? 'block' : 'none';

    if (ledFlicker) door.setLed(ledFlicker.color, THREE.MathUtils.lerp(ledFlicker.lo, ledFlicker.hi, Math.random()));
    tweens.update(dt);
    effects.update(dt);
    door.update(dt);
    renderer.render(scene, camera);
  });
  refreshGate();

  // --- Zamanlama yardımcıları ---
  const at = (t: number, fn: () => void) =>
    tweens.add((_dt, el) => {
      if (el < t) return true;
      fn();
      return false;
    });
  const anim = (start: number, dur: number, fn: (k: number, t: number) => void) =>
    tweens.add((_dt, el) => {
      if (el < start) return true;
      const k = Math.min(1, (el - start) / dur);
      fn(k, el - start);
      return k < 1;
    });
  const ease = (k: number) => k * k * (3 - 2 * k);

  const focusCamera = (dur: number) => {
    const from = camera.quaternion.clone();
    const probe = camera.clone();
    probe.lookAt(door.focusPoint);
    const to = probe.quaternion.clone();
    anim(0, dur, (k) => camera.quaternion.slerpQuaternions(from, to, ease(k)));
  };

  const moveDoor = (start: number, dur: number, to: number, shake = 0) => {
    let from: number | null = null;
    anim(start, dur, (k, t) => {
      from ??= door.openAmount;
      door.openAmount = Math.max(0, THREE.MathUtils.lerp(from, to, ease(k)) + (k < 1 ? Math.sin(t * 45) * shake : 0));
    });
  };

  const T0 = 0.6; // kamera odaklandıktan sonra
  const play = (o: Outcome): number => {
    switch (o.kind) {
      case 'success':
        at(T0, () => {
          door.setLed(0x30ff70, 1);
          door.setScreen('KİLİT AÇIK', '#40ff80');
        });
        moveDoor(T0 + 0.4, 1.6, 1);
        solved = true;
        return T0 + 2.2;
      case 'dim':
        at(T0, () => {
          ledFlicker = { color: 0xffa040, lo: 0.08, hi: 0.3 };
          door.setScreen('SİNYAL ZAYIF', '#ffb030', true);
        });
        moveDoor(T0 + 0.3, 1.2, 0.12, 0.015);
        return T0 + 2.2;
      case 'no_light':
        at(T0, () => door.setScreen('SİNYAL YOK', '#ffb030', true));
        moveDoor(T0 + 0.2, 0.3, 0.03, 0.01);
        moveDoor(T0 + 0.6, 0.3, 0);
        return T0 + 1.8;
      case 'led_stressed':
        anim(T0, 0.8, (k) => door.setLed(0xfff0d0, 1 + 2.5 * k));
        at(T0 + 0.8, () => (ledFlicker = { color: 0xfff0d0, lo: 0.2, hi: 3.5 }));
        at(T0 + 1.4, () => {
          ledFlicker = null;
          door.setLed(0, 0);
          door.setScreen('AŞIRI AKIM\nHAT KESİLDİ', '#ff5040', true);
        });
        moveDoor(T0 + 0.2, 0.6, 0.08);
        moveDoor(T0 + 1.4, 0.4, 0);
        return T0 + 2.4;
      case 'led_burnt':
        at(T0, () => door.setLed(0xffffff, 4));
        at(T0 + 0.15, () => {
          effects.sparkBurst(door.ledPosition);
          door.burnLed();
          door.showScorch();
          door.setScreen('LED ARIZASI', '#ff5040', true);
        });
        return T0 + 2.2;
      case 'fuse_blown':
        at(T0, () => effects.sparkBurst(door.ledPosition, 90));
        at(T0 + 0.1, () => {
          corridor.setPower(0);
          door.setScreen('', '#000');
          effects.setAlarm(true);
        });
        return T0 + 2.6;
      case 'resistor_burnt':
        at(T0, () => {
          effects.smokePuff(door.ledPosition, 3);
          door.showScorch();
          door.setScreen('DİRENÇ ARIZASI', '#ff5040', true);
        });
        return T0 + 2.4;
    }
  };

  return {
    suspend() {
      active = false;
      player.enabled = false;
      player.controls.unlock();
      refreshGate();
    },
    resume() {
      active = true;
      player.enabled = true;
      refreshGate();
    },
    applyOutcome(o) {
      tweens.clear();
      focusCamera(T0);
      const duration = play(o);
      if (o.resistorOverheat && o.kind !== 'resistor_burnt') {
        at(T0 + 0.2, () => {
          effects.smokePuff(door.ledPosition, 2.5);
          door.showScorch();
        });
      }
      return new Promise((done) => at(duration, done));
    },
    repairForRetry() {
      ledFlicker = null;
      corridor.setPower(1);
      effects.setAlarm(false);
      door.replaceLed();
      door.setScreen(FAULT_SCREEN[0], FAULT_SCREEN[1], true);
      moveDoor(0, 0.5, 0);
    },
  };
}
