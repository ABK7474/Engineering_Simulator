// Hub cephesi: dünyayı (bütün odalar, kapılar, terminaller) kurar, gezinmeyi ve etkileşimi yönetir,
// Outcome'u görsel efekte çevirir. Bulmaca mantığını, kaynakları ve dünya durumunu bilmez: hangi
// terminalin ne göstereceğini, kapıların ne zaman açılacağını dışarısı söyler.

import * as THREE from 'three';
import { StrideCounter } from '../audio/mix';
import type { Outcome } from '../core/types';
import { CEILING, roomAt, type WorldLayout } from '../world/layout';
import { loadAssets } from './assets';
import { buildAtmosphere } from './atmosphere';
import { buildBuilding } from './building';
import { createDoor, type Door } from './door';
import { Effects, Tweens } from './effects';
import { buildExterior } from './exterior';
import { noiseLevel, stepProfile } from './movement';
import { createPlayer } from './player';
import { createSceneKit } from './scene';
import { createTerminal, type Terminal } from './terminal';

export type HubSfx = 'door_open' | 'door_close' | 'spark' | 'led_pop' | 'fuse' | 'jam' | 'step' | 'steam' | 'sonar' | 'roar' | 'rumble' | 'splash';

/** Hub'ın istediği sesler; uygulaması audio/ katmanında. */
export interface HubSounds {
  play: (name: HubSfx, opts?: { volume?: number; delay?: number; pitchJitter?: number }) => void;
  sparks: (seconds?: number) => void;
  alarm: (seconds: number) => void;
  setLeakVolume: (v: number) => void;
  setLoop: (name: 'leak' | 'gas' | 'drip', v: number) => void;
}

export interface HubOptions {
  /** public/assets'in URL'si (sonunda / ile). */
  assetBase: string;
  sounds: HubSounds;
  layout: WorldLayout;
  /** Oyuncunun başlayacağı konum. */
  spawn: { x: number; z: number; yaw: number };
  /** E ile bir terminalle etkileşim. */
  onInteract: (terminalId: string) => void;
  /** Terminalin yanında gösterilecek ipucu; null = etkileşim yok (ör. onarılmış). */
  hintFor: (terminalId: string) => string | null;
  /** Oyuncu başka bir odaya geçti. */
  onRoomChange: (roomId: string) => void;
  /** "Tıkla ve başla" tıklaması: kullanıcı etkileşimi (ses burada başlatılabilir). */
  onStart: () => void;
}

export interface OutcomeOptions {
  /** false: ara aşama başarısı (LED yeşil, ekranda progressText). */
  final?: boolean;
  progressText?: string;
  /** Bu arızanın sürdüğü kapı (motor sonuçları kapıyı oynatır). */
  doorId?: string;
}

export interface Hub {
  /** Girdiyi kapatır, imleci serbest bırakır (2D panel açılırken). */
  suspend: () => void;
  /** Girdiyi açar; oyuncu tıklayınca yürümeye devam eder. */
  resume: () => void;
  /** Sonucu bir terminalde oynatır; izlenebilir kısım bitince çözülür. */
  applyOutcome: (terminalId: string, o: Outcome, opts?: OutcomeOptions) => Promise<void>;
  setScreen: (terminalId: string, text: string, color: string, blink?: boolean) => void;
  /** Arıza kısmen onarılmışken: LED yeşil + metin. */
  showProgress: (terminalId: string, text: string) => void;
  /** Onarılmış terminal: LED yeşil, ekran metni. */
  showSolved: (terminalId: string, text: string) => void;
  /** Başarısızlık sonrası yedek parça: ışıklar, LED, (varsa) kapı eski hâline; yanık izi kalır. */
  repairForRetry: (terminalId: string, doorId?: string) => void;
  /** Kapıyı aç/kapat; `animate` ise kayarak ve sesle. */
  setDoorOpen: (doorId: string, open: boolean, animate?: boolean) => void;
  /** Kritik kaynakta odadan yeniden başlama: terminaller yenilenir, ışıklar geri gelir. */
  resetTerminals: (terminalIds: string[]) => void;
  /** Oyuncuyu bir noktaya taşır (oda girişi). */
  teleport: (x: number, z: number, yaw: number) => void;
  /** Kırmızı uyarı ışığı (hata onarılana kadar ya da kaynaklar azken; kararı dışarısı verir). */
  setWarningLight: (on: boolean) => void;
  isRoaming: () => boolean;
  restoreScars: (terminalIds: string[]) => void;
  hasScorch: (terminalId: string) => boolean;
  /** Harita için: oyuncunun konumu ve bakış yönü. */
  pose: () => { x: number; z: number; yaw: number };
  terminalPosition: (terminalId: string) => { x: number; z: number };
  /** Oyuncunun gürültü seviyesi: hareketsiz/eğilme 0, yürüme 1, koşma 2 (tehdit olayında yaklaşmayı hızlandırır). */
  noiseLevel: () => 0 | 1 | 2;
  /** Tehdit olayı sürerken gövdeden gelen sesler sıklaşır. */
  setThreat: (on: boolean) => void;
  /** Yaratık istasyona çarpar: kükreme, ışıklar söner gibi titrer, pencerelerin önünden gölge geçer. */
  threatStrike: () => void;
  /** Tehdit sona erdi: gölge uzaklaşarak geçer. */
  creaturePass: () => void;
  /** Geliştirme/test kancaları (oyunda kullanılmaz). */
  debug: { setYaw: (rad: number) => void; forceShadowPass: (k: number) => void; teleport: (x: number, z: number, yaw?: number) => void; doors: () => Record<string, number>; breakdown: () => Record<string, { calls: number; triangles: number }>; materials: () => Record<string, { meshes: number; materials: number; signatures: number }>; heavy: (room: string) => [string, number][]; hide: (name: string, hidden: boolean) => number; describe: (index: number) => string };
  stats: () => { calls: number; triangles: number; geometries: number; textures: number; x: number; z: number; y: number; mode: string; exterior: boolean; room: string | null };
}

const INTERACT_RANGE = 1.8;
const ALARM_SECONDS = 4.5;
const PROGRESS_COLOR = '#ffd040';

export async function createHub(container: HTMLElement, opts: HubOptions): Promise<Hub> {
  const { sounds, layout } = opts;

  // --- DOM: başlangıç/devam katmanı (yükleme sırasında da görünür) ---
  const gate = document.createElement('div');
  gate.className = 'gate';
  gate.innerHTML = `<div><h1>Derin Mühendis</h1><p class="gate-action">Yükleniyor…</p>
    <p class="keys">WASD / oklar: yürü · W W (çift dokun): koş · C: eğil (aç/kapa) · Fare: bak · E: etkileşim · M: harita · N: sessiz · Esc: imleci bırak</p></div>`;
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
  const building = buildBuilding(scene, assets, layout);
  const doors = new Map<string, Door>(layout.doors.map((d) => [d.def.id, createDoor(scene, assets, d)]));
  // LED'lerin paylaştığı tek dinamik ışık (ışık bütçesi)
  const ledLight = new THREE.PointLight(0xffffff, 0, 3, 2);
  scene.add(ledLight);
  const terminals = new Map<string, Terminal>(layout.terminals.map((t) => [t.fault.id, createTerminal(scene, t, ledLight)]));
  const exterior = buildExterior(scene, layout);
  const atmosphere = buildAtmosphere(scene, layout);
  // Güç seviyesi (sonuçlar ayarlar) ile geçici titreme düşüşü (gümbürtü) ayrı: çarpımları uygulanır
  let powerLevel = 1;
  let powerDip = 1;
  const applyPower = () => {
    building.setPower(powerLevel * powerDip);
    atmosphere.setPower(powerLevel * powerDip);
  };
  const setPower = (level: number) => {
    powerLevel = level;
    applyPower();
  };
  // Görünürlük: bulunulan oda + AÇIK (ya da açılmakta olan) kapılarla bağlı komşular; kapalı metal kapının
  // arkası görünmez, çizilmez. İlk karelerde hepsi çizilir ki sabit gölge haritası bütün odaları içersin.
  const visibleFrom = (here: string): Set<string> => {
    const out = new Set([here]);
    for (const d of layout.doors) {
      const [a, b2] = d.def.rooms;
      if ((doors.get(d.def.id)?.openAmount ?? 0) <= 0.02) continue;
      if (a === here) out.add(b2);
      if (b2 === here) out.add(a);
    }
    return out;
  };
  let frames = 0;
  let visKey = '';
  // Uzak yaratık: ara sıra gövdeden gelen derin gümbürtü (nadiren kükreme); ışıklar bir an titrer
  let rumbleIn = 50 + Math.random() * 60;
  let threatOn = false;
  const quake = (seconds: number, depth: number) =>
    anim(0.2, seconds, (k) => {
      powerDip = k < 1 ? 1 - depth * Math.sin(k * Math.PI) * (0.5 + 0.5 * Math.random()) : 1;
      applyPower();
    });
  const refreshVisibility = () => {
    if (!room || frames < 3) return;
    const v = visibleFrom(room);
    const key = [...v].sort().join(',');
    if (key !== visKey) {
      visKey = key;
      building.setVisibleRooms(v);
    }
  };
  const first = layout.terminals[0];
  const effects = new Effects(scene, new THREE.Vector3(first?.x ?? 0, CEILING - 0.3, first?.z ?? 0));
  const tweens = new Tweens();
  // Durum kapıları (açıldı/kapandı) ayrı zamanlayıcıda: sonuç efektleri `tweens`i temizler; açılmakta olan bir
  // kapının animasyonu silinirse kapı yarı açık kalırdı.
  const doorTweens = new Tweens();
  const player = createPlayer(camera, renderer.domElement, new THREE.Vector3(opts.spawn.x, 0, opts.spawn.z));
  camera.rotation.set(0, opts.spawn.yaw, 0, 'YXZ');
  const leaks = layout.leaks.map((l) => new THREE.Vector3(l.x, l.y, l.z));
  const strides = new StrideCounter(stepProfile('walk').stride);
  kit.bakeShadows();

  let active = true; // false: 2D panel ya da sonuç oynatımı sürüyor
  let ledFlicker: { t: Terminal; color: number; lo: number; hi: number } | null = null;
  let room: string | null = null;

  gateAction.textContent = 'Tıkla ve başla';
  gate.addEventListener('click', () => {
    opts.onStart();
    player.controls.lock();
  });

  const hint = document.createElement('div');
  hint.className = 'hint';
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

  let nearest: string | null = null;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && active && nearest && locked) opts.onInteract(nearest);
  });

  // --- Döngü ---
  const timer = new THREE.Timer();
  let elapsed = 0;
  timer.connect(document);
  const flat = new THREE.Vector2();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    elapsed += dt;
    const colliders = [...building.colliders, ...[...doors.values()].filter((d) => d.openAmount < 0.95).map((d) => d.collider)];
    const { distance, mode } = player.update(dt, colliders);
    const prof = stepProfile(mode);
    strides.setStride(prof.stride);
    for (let k = strides.add(distance); k > 0; k--) sounds.play('step', { volume: prof.volume, pitchJitter: 0.08 });
    const leakNear = Math.max(0, 1 - Math.min(...leaks.map((l) => camera.position.distanceTo(l)), Infinity) / 7);
    sounds.setLeakVolume(leakNear * leakNear);
    const near = (kind: 'gas' | 'drip', range: number) => Math.max(0, 1 - atmosphere.nearest(kind, camera.position) / range) ** 2;
    sounds.setLoop('gas', near('gas', 8));
    sounds.setLoop('drip', near('drip', 7));
    for (const p of atmosphere.takeBursts()) {
      const d = camera.position.distanceTo(p);
      if (d < 14) sounds.play('steam', { volume: 0.7 * (1 - d / 14) ** 1.5, pitchJitter: 0.1 });
    }

    // En yakın, etkileşime açık terminal
    nearest = null;
    let best = INTERACT_RANGE;
    for (const t of terminals.values()) {
      const d = flat.set(camera.position.x - t.panelPosition.x, camera.position.z - t.panelPosition.z).length();
      if (d < best && opts.hintFor(t.id) !== null) {
        best = d;
        nearest = t.id;
      }
    }
    const hintText = nearest ? opts.hintFor(nearest) : null;
    hint.style.display = active && hintText && locked ? 'block' : 'none';
    if (hintText && hint.textContent !== hintText) hint.textContent = hintText;

    // Oda geçişi (kesintisiz; bütün odalar zaten kurulu)
    const r = roomAt(layout, camera.position.x, camera.position.z);
    if (r && r !== room) {
      room = r;
      opts.onRoomChange(r);
    }
    frames++;
    refreshVisibility();
    if (locked) rumbleIn -= dt;
    if (rumbleIn <= 0) {
      rumbleIn = threatOn ? 14 + Math.random() * 14 : 75 + Math.random() * 90;
      const roar = Math.random() < (threatOn ? 0.6 : 0.25);
      sounds.play(roar ? 'roar' : 'rumble', { volume: roar ? 0.35 : 0.5, pitchJitter: 0.06 });
      anim(0.4, 1.6, (k) => {
        powerDip = k < 1 ? 1 - 0.35 * Math.sin(k * Math.PI) * (0.6 + 0.4 * Math.random()) : 1;
        applyPower();
      });
    }

    if (ledFlicker) ledFlicker.t.setLed(ledFlicker.color, THREE.MathUtils.lerp(ledFlicker.lo, ledFlicker.hi, Math.random()), true);
    tweens.update(dt);
    doorTweens.update(dt);
    effects.update(dt);
    for (const d of doors.values()) d.update();
    for (const t of terminals.values()) t.update(dt);
    exterior.update(dt, elapsed, camera);
    building.update(dt, elapsed, camera);
    atmosphere.update(dt, elapsed, camera);
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

  const focusCamera = (target: THREE.Vector3, dur: number) => {
    const from = camera.quaternion.clone();
    const probe = camera.clone();
    probe.lookAt(target);
    const to = probe.quaternion.clone();
    anim(0, dur, (k) => camera.quaternion.slerpQuaternions(from, to, ease(k)));
  };

  const moveDoor = (door: Door | undefined, start: number, dur: number, to: number, shake = 0) => {
    if (!door) return;
    let from: number | null = null;
    anim(start, dur, (k, t) => {
      from ??= door.openAmount;
      door.openAmount = Math.max(0, THREE.MathUtils.lerp(from, to, ease(k)) + (k < 1 ? Math.sin(t * 45) * shake : 0));
    });
  };

  const T0 = 0.6; // kamera odaklandıktan sonra
  const get = (id: string) => {
    const t = terminals.get(id);
    if (!t) throw new Error(`Bilinmeyen terminal: ${id}`);
    return t;
  };

  const play = (t: Terminal, door: Door | undefined, o: Outcome, final: boolean, progressText: string): number => {
    // Motor kapının üst kasasında; kapı yoksa (ör. fan) terminalin yanında
    const motorPos = door ? door.position.clone().add(new THREE.Vector3(0.6, 2.2, 0.3)) : t.ledPosition.clone();
    switch (o.kind) {
      case 'success':
        at(T0, () => {
          t.setLed(0x30ff70, 1, true);
          t.setScreen(final ? 'ONARILDI' : progressText, final ? '#40ff80' : PROGRESS_COLOR);
        });
        return T0 + 1.6;
      case 'dim':
        at(T0, () => {
          ledFlicker = { t, color: 0xffa040, lo: 0.08, hi: 0.3 };
          t.setScreen('SİNYAL ZAYIF', '#ffb030', true);
        });
        moveDoor(door, T0 + 0.3, 1.2, 0.12, 0.015);
        at(T0 + 0.3, () => sounds.play('jam', { volume: 0.8 }));
        return T0 + 2.2;
      case 'no_light':
        at(T0, () => t.setScreen('SİNYAL YOK', '#ffb030', true));
        moveDoor(door, T0 + 0.2, 0.3, 0.03, 0.01);
        at(T0 + 0.2, () => sounds.play('jam', { volume: 0.4 }));
        moveDoor(door, T0 + 0.6, 0.3, 0);
        return T0 + 1.8;
      case 'led_stressed':
        anim(T0, 0.8, (k) => t.setLed(0xfff0d0, 1 + 2.5 * k, true));
        at(T0 + 0.8, () => (ledFlicker = { t, color: 0xfff0d0, lo: 0.2, hi: 3.5 }));
        at(T0 + 1.4, () => {
          ledFlicker = null;
          t.setLed(0, 0, true);
          sounds.sparks(0.3);
          t.setScreen('AŞIRI AKIM\nHAT KESİLDİ', '#ff5040', true);
        });
        moveDoor(door, T0 + 0.2, 0.6, 0.08);
        moveDoor(door, T0 + 1.4, 0.4, 0);
        return T0 + 2.4;
      case 'led_burnt':
        at(T0, () => t.setLed(0xffffff, 4, true));
        at(T0 + 0.15, () => {
          effects.sparkBurst(t.ledPosition);
          sounds.play('led_pop');
          sounds.sparks(0.6);
          t.burnLed();
          t.showScorch();
          t.setScreen('LED ARIZASI', '#ff5040', true);
        });
        return T0 + 2.2;
      case 'fuse_blown':
        at(T0, () => {
          effects.sparkBurst(t.ledPosition, 90);
          sounds.sparks(0.5);
        });
        at(T0 + 0.1, () => {
          sounds.play('fuse');
          setPower(0);
          t.setScreen('', '#000');
        });
        return T0 + 2.6;
      case 'motor_stall':
        at(T0, () => {
          sounds.play('jam', { volume: 0.5 });
          t.setScreen('MOTOR\nDÖNMÜYOR', '#ffb030', true);
        });
        moveDoor(door, T0, 0.25, 0.015, 0.006);
        moveDoor(door, T0 + 0.4, 0.25, 0);
        return T0 + 1.8;
      case 'motor_slow':
        at(T0, () => t.setScreen('MOTOR ZAYIF', '#ffb030', true));
        moveDoor(door, T0 + 0.2, 2.2, 0.22, 0.01);
        at(T0 + 2.2, () => sounds.play('jam', { volume: 0.8 }));
        return T0 + 2.8;
      case 'motor_overheat':
        moveDoor(door, T0 + 0.1, 0.9, 0.35);
        at(T0 + 1.0, () => {
          sounds.play('jam', { volume: 0.6 });
          effects.smokePuff(motorPos, 2);
          t.setScreen('TERMİK\nKORUMA', '#ff5040', true);
        });
        return T0 + 2.6;
      case 'motor_burnt':
        moveDoor(door, T0 + 0.1, 0.5, 0.15, 0.01);
        at(T0 + 0.5, () => {
          effects.sparkBurst(motorPos, 70);
          sounds.sparks(0.7);
          sounds.play('fuse', { volume: 0.6 });
          effects.smokePuff(motorPos, 3.5);
          t.setScreen('MOTOR YANDI', '#ff5040', true);
        });
        return T0 + 2.8;
      case 'resistor_burnt':
        at(T0, () => {
          effects.smokePuff(t.ledPosition, 3);
          sounds.sparks(0.3);
          t.showScorch();
          t.setScreen('DİRENÇ ARIZASI', '#ff5040', true);
        });
        return T0 + 2.4;
      // Veri yapıları (trace): bellek ve zamanlayıcı hataları ekranda ve ışıkta görünür
      case 'core_reboot':
        at(T0, () => {
          t.setLed(0xffb030, 1, true);
          t.setScreen('ÇEKİRDEK\nYENİDEN BAŞLIYOR', '#ffb030', true);
          sounds.play('jam', { volume: 0.4 });
        });
        at(T0 + 0.6, () => setPower(0.5));
        at(T0 + 1.4, () => setPower(1));
        return T0 + 2.2;
      case 'core_crash':
        at(T0, () => {
          t.setLed(0xff3020, 1.5, true);
          ledFlicker = { t, color: 0xff3020, lo: 0.1, hi: 1.6 };
          t.setScreen('ÇEKİRDEK ÇÖKTÜ\nBELLEK BOZUK', '#ff5040', true);
          sounds.play('fuse', { volume: 0.5 });
          setPower(0.25);
        });
        return T0 + 2.6;
      case 'sensor_misread':
        at(T0, () => {
          ledFlicker = { t, color: 0xffb030, lo: 0.2, hi: 1 };
          t.setScreen('SENSÖR\nOKUMA HATASI', '#ffb030', true);
          sounds.play('jam', { volume: 0.3 });
        });
        return T0 + 2;
      case 'signal_weak':
        at(T0, () => {
          ledFlicker = { t, color: 0xffb030, lo: 0.05, hi: 0.4 };
          t.setScreen('VERİCİ ZAYIF\nSİNYAL YOK', '#ffb030', true);
          sounds.play('jam', { volume: 0.3 });
        });
        return T0 + 2;
      case 'opamp_saturated':
        at(T0, () => {
          t.setLed(0xff5040, 1.2, true);
          t.setScreen('SENSÖR DOYDU\nSİNYAL KIRPIK', '#ff5040', true);
          sounds.play('jam', { volume: 0.4 });
        });
        return T0 + 2;
      case 'valve_slam':
        at(T0 + 0.3, () => {
          sounds.play('jam', { volume: 1 });
          effects.sparkBurst(t.ledPosition, 40);
          t.setScreen('VALF ÇARPTI\nDARBE', '#ff5040', true);
        });
        return T0 + 2.2;
      case 'valve_late':
        at(T0, () => t.setScreen('VALF GEÇ\nBASINÇ KAÇAĞI', '#ffb030', true));
        at(T0 + 1.2, () => sounds.play('jam', { volume: 0.6 }));
        return T0 + 2.4;
      case 'valve_stuck':
        at(T0, () => {
          t.setLed(0, 0, true);
          t.setScreen('VALF\nATEŞLEMEDİ', '#ffb030', true);
          sounds.play('jam', { volume: 0.3 });
        });
        return T0 + 2;
      case 'core_freeze':
        at(T0, () => {
          t.setLed(0xffb030, 0.8, true);
          t.setScreen('ZAMANLAYICI\nDONDU', '#ffb030', false);
          sounds.play('jam', { volume: 0.5 });
        });
        return T0 + 2;
      case 'false_alarm':
        at(T0, () => {
          ledFlicker = { t, color: 0xff5040, lo: 0.1, hi: 1.2 };
          t.setScreen('BOŞA TAHLİYE\nBÖLME KAPANDI', '#ffb030', true);
          sounds.play('door_close', { volume: 0.8 });
        });
        at(T0 + 0.8, () => sounds.play('steam', { volume: 0.5 }));
        return T0 + 2.2;
      case 'leak_ignored':
        at(T0, () => {
          t.setLed(0xff5040, 1, true);
          t.setScreen('KAÇAK\nSÜRÜYOR', '#ff5040', true);
          sounds.play('splash', { volume: 0.9 });
        });
        return T0 + 2.2;
      case 'redundancy_lost':
        at(T0, () => {
          t.setLed(0xff5040, 1, true);
          t.setScreen('YEDEK YETMEDİ', '#ff5040', true);
          sounds.play('jam', { volume: 0.6 });
        });
        at(T0 + 0.9, () => sounds.play('splash', { volume: 0.6 }));
        return T0 + 2.2;
      case 'creature_alerted':
      case 'creature_strike':
        at(T0, () => {
          t.setScreen('TEMAS\nGÖVDEYE ÇARPTI', '#ff5040', true);
          sounds.play('roar', { volume: 0.9 });
          sounds.play('rumble', { volume: 1 });
          quake(2.6, 0.8);
          exterior.forcePass(0.42);
        });
        at(T0 + 0.6, () => effects.sparkBurst(t.ledPosition, 30));
        return T0 + 3;
      case 'dark_stumble':
        at(T0, () => {
          t.setScreen('ACİL IŞIK\nERKEN SÖNDÜ', '#ffb030', true);
          quake(1.8, 0.95);
          sounds.play('jam', { volume: 0.7 });
        });
        return T0 + 2.4;
      case 'power_waste':
        at(T0, () => {
          ledFlicker = { t, color: 0xffb030, lo: 0.3, hi: 0.9 };
          t.setScreen('AŞIRI YÜK\nGÜÇ İSRAFI', '#ffb030', false);
          sounds.play('jam', { volume: 0.3 });
        });
        return T0 + 2;
    }
  };

  const yawOf = () => new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  const teleport = (x: number, z: number, yaw: number) => {
    camera.position.set(x, camera.position.y, z);
    camera.rotation.set(0, yaw, 0, 'YXZ');
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
    applyOutcome(id, o, oo = {}) {
      const t = get(id);
      const door = oo.doorId ? doors.get(oo.doorId) : undefined;
      tweens.clear();
      focusCamera(t.focusPoint, T0);
      effects.moveAlarm(new THREE.Vector3(t.panelPosition.x, CEILING - 0.3, t.panelPosition.z));
      const duration = play(t, door, o, oo.final ?? true, oo.progressText ?? '');
      if (o.kind !== 'success') {
        // Her yanlış cevapta: siren en fazla ALARM_SECONDS; kırmızı ışık onarıma kadar sürer.
        at(T0 + 0.2, () => {
          effects.setAlarm(true);
          sounds.alarm(ALARM_SECONDS);
        });
      }
      if (o.resistorOverheat && o.kind !== 'resistor_burnt') {
        at(T0 + 0.2, () => {
          effects.smokePuff(t.ledPosition, 2.5);
          t.showScorch();
        });
      }
      return new Promise((done) => at(duration, done));
    },
    setScreen(id, text, color, blink = false) {
      get(id).setScreen(text, color, blink);
    },
    showProgress(id, text) {
      const t = get(id);
      t.setLed(0x30ff70, 1);
      t.setScreen(text, PROGRESS_COLOR);
    },
    showSolved(id, text) {
      const t = get(id);
      t.setLed(0x30ff70, 1);
      t.setScreen(text, '#40ff80');
    },
    repairForRetry(id, doorId) {
      ledFlicker = null;
      setPower(1);
      effects.setAlarm(false);
      get(id).replaceLed();
      const door = doorId ? doors.get(doorId) : undefined;
      if (door && door.openAmount > 0.01) {
        sounds.play('door_close', { volume: 0.7 });
        moveDoor(door, 0, 0.5, 0);
      }
    },
    setDoorOpen(id, open, animate = false) {
      const door = doors.get(id);
      if (!door) return;
      const target = open ? 1 : 0;
      if (!animate) {
        door.openAmount = target;
        return;
      }
      if (Math.abs(door.openAmount - target) < 0.01) return;
      sounds.play(open ? 'door_open' : 'door_close');
      const from = door.openAmount;
      doorTweens.add((_dt, el) => {
        const k = Math.min(1, el / 1.6);
        door.openAmount = THREE.MathUtils.lerp(from, target, ease(k));
        return k < 1;
      });
    },
    resetTerminals(ids) {
      tweens.clear();
      ledFlicker = null;
      setPower(1);
      effects.setAlarm(false);
      for (const id of ids) get(id).replaceLed();
    },
    teleport,
    setWarningLight(on) {
      effects.setAlarm(on);
    },
    setThreat(on) {
      threatOn = on;
      if (on) rumbleIn = Math.min(rumbleIn, 6);
    },
    threatStrike() {
      sounds.play('roar', { volume: 0.9 });
      sounds.play('rumble', { volume: 1 });
      quake(3, 0.8);
      exterior.forcePass(0.42);
    },
    creaturePass() {
      sounds.play('rumble', { volume: 0.4 });
      exterior.forcePass(0.12);
    },
    isRoaming: () => active && locked && document.visibilityState === 'visible',
    restoreScars(ids) {
      for (const id of ids) terminals.get(id)?.showScorch();
    },
    hasScorch: (id) => get(id).hasScorch(),
    pose: () => ({ x: camera.position.x, z: camera.position.z, yaw: yawOf() }),
    terminalPosition: (id) => ({ x: get(id).panelPosition.x, z: get(id).panelPosition.z }),
    noiseLevel: () => noiseLevel(player.mode),
    debug: {
      setYaw: (rad) => camera.rotation.set(0, rad, 0, 'YXZ'),
      forceShadowPass: (k) => exterior.forcePass(k),
      doors: () => Object.fromEntries([...doors.values()].map((d) => [d.id, Math.round(d.openAmount * 1000) / 1000])),
      hide(name, hidden) {
        let n = 0;
        scene.traverse((o) => {
          if (o.name === name || o.type === name || (name.startsWith('#') && o.parent === scene && scene.children.indexOf(o) === Number(name.slice(1)))) {
            o.visible = !hidden;
            n++;
          }
        });
        return n;
      },
      describe(index) {
        const o = scene.children[index];
        if (!o) return '';
        const kinds = new Set<string>();
        o.traverse((c) => {
          const m = (c as THREE.Mesh).material as THREE.Material | undefined;
          if (m) kinds.add(`${c.type}:${m.name || m.type}`);
        });
        return `${o.name || o.type} [${[...kinds].slice(0, 6).join(', ')}]`;
      },
      heavy(room) {
        const tris: Record<string, number> = {};
        const count: Record<string, number> = {};
        scene.getObjectByName(`room:${room}`)?.traverse((o) => {
          for (const [k, v] of Object.entries((o.userData.tris ?? {}) as Record<string, number>)) tris[k] = (tris[k] ?? 0) + v;
          for (const [k, v] of Object.entries((o.userData.count ?? {}) as Record<string, number>)) count[k] = Math.max(count[k] ?? 0, v);
        });
        return Object.entries(tris).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => [`${k}×${count[k]}`, v]);
      },
      materials() {
        const out: Record<string, { meshes: number; materials: number; signatures: number }> = {};
        for (const c of scene.children) {
          if (!c.name.startsWith('room:') && c.name !== 'shared') continue;
          const mats = new Set<THREE.Material>();
          const sigs = new Set<string>();
          let meshes = 0;
          c.traverse((o) => {
            if (!(o instanceof THREE.Mesh)) return;
            meshes++;
            const m = o.material as THREE.MeshStandardMaterial;
            mats.add(m);
            sigs.add([m.type, m.map?.uuid, m.normalMap?.uuid, m.roughnessMap?.uuid, m.metalnessMap?.uuid, m.color?.getHexString(), m.transparent, m.side].join('|'));
          });
          out[c.name] = { meshes, materials: mats.size, signatures: sigs.size };
        }
        return out;
      },
      breakdown() {
        // Her görünür üst düzey nesneyi sırayla gizleyip çizer; farkı o nesnenin payıdır.
        const draw = () => {
          renderer.render(scene, camera);
          return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
        };
        const base = draw();
        const out: Record<string, { calls: number; triangles: number }> = { toplam: base };
        const groups = new Map<string, THREE.Object3D[]>();
        for (const c of scene.children) {
          if (!c.visible) continue;
          const key = c.name || c.type;
          groups.set(key, [...(groups.get(key) ?? []), c]);
        }
        for (const [key, objs] of groups) {
          objs.forEach((o) => (o.visible = false));
          const r = draw();
          objs.forEach((o) => (o.visible = true));
          if (base.calls - r.calls > 0) out[key] = { calls: base.calls - r.calls, triangles: base.triangles - r.triangles };
        }
        draw();
        return out;
      },
      teleport: (x, z, yaw) => teleport(x, z, yaw ?? yawOf()),
    },
    stats() {
      const { calls, triangles } = renderer.info.render;
      const { geometries, textures } = renderer.info.memory;
      return { calls, triangles, geometries, textures, x: camera.position.x, z: camera.position.z, y: camera.position.y, mode: player.mode, exterior: exterior.visible, room };
    },
  };
}
