// Hub cephesi: sahneyi kurar, gezinmeyi ve etkileşimi yönetir, Outcome'u görsel efekte çevirir.
// Bulmaca mantığını ve ses motorunu bilmez; Outcome'u okur, sesleri HubSounds arayüzüyle ister.

import * as THREE from 'three';
import type { Outcome } from '../core/types';
import { StrideCounter } from '../audio/mix';
import { loadAssets } from './assets';
import { buildCorridor } from './corridor';
import { createDoorPanel } from './door-panel';
import { Effects, Tweens } from './effects';
import { buildLayout } from './layout';
import { createPlayer } from './player';
import { createSceneKit } from './scene';

export type HubSfx = 'door_open' | 'door_close' | 'spark' | 'led_pop' | 'fuse' | 'jam' | 'step';

/** Hub'ın istediği sesler; uygulaması audio/ katmanında. */
export interface HubSounds {
  play: (name: HubSfx, opts?: { volume?: number; delay?: number; pitchJitter?: number }) => void;
  sparks: (seconds?: number) => void;
  alarm: (seconds: number) => void;
  setLeakVolume: (v: number) => void;
}

export interface HubOptions {
  /** public/assets'in URL'si (sonunda / ile). */
  assetBase: string;
  sounds: HubSounds;
  onInteract: () => void;
  /** "Tıkla ve başla" tıklaması: kullanıcı etkileşimi (ses burada başlatılabilir). */
  onStart: () => void;
}

export interface Hub {
  /** Girdiyi kapatır, imleci serbest bırakır (2D panel açılırken). */
  suspend: () => void;
  /** Girdiyi açar; oyuncu tıklayınca yürümeye devam eder. */
  resume: () => void;
  /** Sonucu sahnede oynatır; izlenebilir kısım bitince çözülür. */
  /**
   * Sonucu sahnede oynatır; izlenebilir kısım bitince çözülür. `final: false` ara aşama başarısıdır:
   * LED yeşil yanar, ekranda `progressText` görünür, kapı açılmaz.
   */
  applyOutcome: (o: Outcome, opts?: { final?: boolean; progressText?: string }) => Promise<void>;
  /** Arıza kısmen onarılmışken panel durumu (LED yeşil + metin); null = arıza ekranı. */
  showProgress: (text: string | null) => void;
  /** Başarısızlık sonrası yedek parça: ışıklar, LED, kapı eski hâline (yanık izi kalır). */
  repairForRetry: () => void;
  /** Kırmızı uyarı ışığı (hata onarılana kadar ya da kaynaklar azken; kararı dışarısı verir). */
  setWarningLight: (on: boolean) => void;
  /** Oyuncu koridorda serbestçe dolaşıyor mu (panel/rapor/giriş ekranı kapalı, sekme görünür). */
  isRoaming: () => boolean;
  /** Bölüm baştan: kapı kilitli, ışıklar ve LED yenilenir; yanık izi kalır. */
  resetEpisode: () => void;
  /** Kayıttan: arıza önceden onarılmış, kapı açık başlar. */
  restoreSolved: () => void;
  /** Kayıttan: önceki hataların izi. */
  restoreScars: (s: { panelScorch: boolean }) => void;
  /** Panelde yanık izi oluştu mu (kalıcı iz olarak kaydedilmek için). */
  hasScorch: () => boolean;
  /** Geliştirme/test için çizim istatistikleri. */
  stats: () => { calls: number; triangles: number; geometries: number; textures: number; x: number; z: number };
}

const INTERACT_RANGE = 1.8;
const ALARM_SECONDS = 4.5;
const STRIDE = 0.65;
const FAULT_SCREEN = ['KİLİT ARIZASI\nPANELİ ONAR', '#ff5040'] as const;

export async function createHub(container: HTMLElement, opts: HubOptions): Promise<Hub> {
  const { sounds } = opts;

  // --- DOM: başlangıç/devam katmanı (yükleme sırasında da görünür) ---
  const gate = document.createElement('div');
  gate.className = 'gate';
  gate.innerHTML = `<div><h1>Derin Mühendis</h1><p class="gate-action">Yükleniyor…</p>
    <p class="keys">WASD / oklar: yürü · Fare: bak · E: etkileşim · Esc: imleci bırak · M: sessiz</p></div>`;
  container.appendChild(gate);
  const gateAction = gate.querySelector<HTMLParagraphElement>('.gate-action')!;

  const kit = createSceneKit(container);
  const { scene, camera, renderer } = kit;
  let assets;
  try {
    assets = await loadAssets(opts.assetBase, renderer);
  } catch (e) {
    gateAction.textContent = `Yükleme hatası: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  }
  const layout = buildLayout();
  const corridor = buildCorridor(scene, assets, layout);
  const door = createDoorPanel(scene, assets, layout);
  const effects = new Effects(scene, new THREE.Vector3(layout.alarm.x, layout.alarm.y, layout.alarm.z));
  const tweens = new Tweens();
  const player = createPlayer(camera, renderer.domElement, new THREE.Vector3(layout.spawn.x, 0, layout.spawn.z));
  const leak = new THREE.Vector3(layout.leak.x, layout.leak.y, layout.leak.z);
  const strides = new StrideCounter(STRIDE);
  kit.bakeShadows();

  door.setScreen(FAULT_SCREEN[0], FAULT_SCREEN[1], true);

  let active = true; // false: 2D panel ya da sonuç oynatımı sürüyor
  let solved = false;
  let ledFlicker: { color: number; lo: number; hi: number } | null = null;

  gateAction.textContent = 'Tıkla ve başla';
  gate.addEventListener('click', () => {
    opts.onStart();
    player.controls.lock();
  });

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
    const walked = player.update(dt, colliders);
    for (let k = strides.add(walked); k > 0; k--) sounds.play('step', { volume: 0.55, pitchJitter: 0.08 });
    const leakNear = Math.max(0, 1 - camera.position.distanceTo(leak) / 7);
    sounds.setLeakVolume(leakNear * leakNear);

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
  // Kilit motoru kapının üst kasasında; motor sonuçları duman/kıvılcımı orada gösterir.
  const motorPos = new THREE.Vector3(0.6, 4.2, layout.doorZ + 0.3);
  const PROGRESS_COLOR = '#ffd040';

  const play = (o: Outcome, final: boolean, progressText: string): number => {
    switch (o.kind) {
      case 'success':
        if (!final) {
          at(T0, () => {
            door.setLed(0x30ff70, 1);
            door.setScreen(progressText, PROGRESS_COLOR);
          });
          return T0 + 1.6;
        }
        at(T0, () => {
          door.setLed(0x30ff70, 1);
          door.setScreen('KİLİT AÇIK', '#40ff80');
        });
        moveDoor(T0 + 0.4, 1.6, 1);
        at(T0 + 0.4, () => sounds.play('door_open'));
        solved = true;
        return T0 + 2.2;
      case 'dim':
        at(T0, () => {
          ledFlicker = { color: 0xffa040, lo: 0.08, hi: 0.3 };
          door.setScreen('SİNYAL ZAYIF', '#ffb030', true);
        });
        moveDoor(T0 + 0.3, 1.2, 0.12, 0.015);
        at(T0 + 0.3, () => sounds.play('jam', { volume: 0.8 }));
        return T0 + 2.2;
      case 'no_light':
        at(T0, () => door.setScreen('SİNYAL YOK', '#ffb030', true));
        moveDoor(T0 + 0.2, 0.3, 0.03, 0.01);
        at(T0 + 0.2, () => sounds.play('jam', { volume: 0.4 }));
        moveDoor(T0 + 0.6, 0.3, 0);
        return T0 + 1.8;
      case 'led_stressed':
        anim(T0, 0.8, (k) => door.setLed(0xfff0d0, 1 + 2.5 * k));
        at(T0 + 0.8, () => (ledFlicker = { color: 0xfff0d0, lo: 0.2, hi: 3.5 }));
        at(T0 + 1.4, () => {
          ledFlicker = null;
          door.setLed(0, 0);
          sounds.sparks(0.3);
          door.setScreen('AŞIRI AKIM\nHAT KESİLDİ', '#ff5040', true);
        });
        moveDoor(T0 + 0.2, 0.6, 0.08);
        moveDoor(T0 + 1.4, 0.4, 0);
        return T0 + 2.4;
      case 'led_burnt':
        at(T0, () => door.setLed(0xffffff, 4));
        at(T0 + 0.15, () => {
          effects.sparkBurst(door.ledPosition);
          sounds.play('led_pop');
          sounds.sparks(0.6);
          door.burnLed();
          door.showScorch();
          door.setScreen('LED ARIZASI', '#ff5040', true);
        });
        return T0 + 2.2;
      case 'fuse_blown':
        at(T0, () => {
          effects.sparkBurst(door.ledPosition, 90);
          sounds.sparks(0.5);
        });
        at(T0 + 0.1, () => {
          sounds.play('fuse');
          corridor.setPower(0);
          door.setScreen('', '#000');
        });
        return T0 + 2.6;
      case 'motor_stall':
        at(T0, () => {
          sounds.play('jam', { volume: 0.5 });
          door.setScreen('MOTOR\nDÖNMÜYOR', '#ffb030', true);
        });
        moveDoor(T0, 0.25, 0.015, 0.006);
        moveDoor(T0 + 0.4, 0.25, 0);
        return T0 + 1.8;
      case 'motor_slow':
        at(T0, () => door.setScreen('MOTOR ZAYIF', '#ffb030', true));
        moveDoor(T0 + 0.2, 2.2, 0.22, 0.01);
        at(T0 + 2.2, () => sounds.play('jam', { volume: 0.8 }));
        return T0 + 2.8;
      case 'motor_overheat':
        moveDoor(T0 + 0.1, 0.9, 0.35);
        at(T0 + 1.0, () => {
          sounds.play('jam', { volume: 0.6 });
          effects.smokePuff(motorPos, 2);
          door.setScreen('TERMİK\nKORUMA', '#ff5040', true);
        });
        return T0 + 2.6;
      case 'motor_burnt':
        moveDoor(T0 + 0.1, 0.5, 0.15, 0.01);
        at(T0 + 0.5, () => {
          effects.sparkBurst(motorPos, 70);
          sounds.sparks(0.7);
          sounds.play('fuse', { volume: 0.6 });
          effects.smokePuff(motorPos, 3.5);
          door.setScreen('MOTOR YANDI', '#ff5040', true);
        });
        return T0 + 2.8;
      case 'resistor_burnt':
        at(T0, () => {
          effects.smokePuff(door.ledPosition, 3);
          sounds.sparks(0.3);
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
    applyOutcome(o, opts = {}) {
      tweens.clear();
      focusCamera(T0);
      const duration = play(o, opts.final ?? true, opts.progressText ?? '');
      if (o.kind !== 'success') {
        // Her yanlış cevapta: siren en fazla ALARM_SECONDS; kırmızı ışık onarıma kadar sürer.
        at(T0 + 0.2, () => {
          effects.setAlarm(true);
          sounds.alarm(ALARM_SECONDS);
        });
      }
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
      if (door.openAmount > 0.01) sounds.play('door_close', { volume: 0.7 });
      moveDoor(0, 0.5, 0);
    },
    showProgress(text) {
      if (solved) return;
      if (text) {
        door.setLed(0x30ff70, 1);
        door.setScreen(text, PROGRESS_COLOR);
      } else {
        door.replaceLed();
        door.setScreen(FAULT_SCREEN[0], FAULT_SCREEN[1], true);
      }
    },
    setWarningLight(on) {
      effects.setAlarm(on);
    },
    isRoaming: () => active && locked && document.visibilityState === 'visible',
    resetEpisode() {
      tweens.clear();
      ledFlicker = null;
      solved = false;
      corridor.setPower(1);
      effects.setAlarm(false);
      door.replaceLed();
      door.setScreen(FAULT_SCREEN[0], FAULT_SCREEN[1], true);
      if (door.openAmount > 0.01) sounds.play('door_close', { volume: 0.7 });
      moveDoor(0, 0.8, 0);
    },
    restoreSolved() {
      solved = true;
      door.openAmount = 1;
      door.setLed(0x30ff70, 1);
      door.setScreen('KİLİT AÇIK', '#40ff80');
    },
    restoreScars(sc) {
      if (sc.panelScorch) door.showScorch();
    },
    hasScorch: () => door.hasScorch(),
    stats() {
      const { calls, triangles } = renderer.info.render;
      const { geometries, textures } = renderer.info.memory;
      return { calls, triangles, geometries, textures, x: camera.position.x, z: camera.position.z };
    },
  };
}
