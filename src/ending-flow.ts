// Kapsül finali akışı: sahne durum makinesini (story/ending.ts, prologla aynı PrologueDirector) hub'ın kapsül sahnesine,
// altyazıya ve sese bağlar. Derinlik eşikleri (`depth:N`) sahnenin derinliğinden, yaratığın durması ve yüzeye çıkış
// sahnenin olaylarından gelir. Sinema şeritleri, "Atla ›" düğmesi; bitince (ya da atlanınca) istasyona dönülür.

import type { AudioEngine } from './audio/engine';
import type { EndingStage } from './hub/hub';
import { depthEvent, type EndingCue, type EndingDef } from './story/ending';
import type { Line, Spoken } from './story/lines';
import { PrologueDirector, type Effect } from './story/prologue';
import type { Subtitles } from './ui/subtitle';

export interface EndingDeps {
  stage: EndingStage;
  def: EndingDef;
  ui: HTMLElement;
  subtitles: Subtitles;
  spoken: (lines: readonly Line[]) => Spoken[];
  audio: AudioEngine;
  /** Sahne bitti ya da atlandı; istasyona dönüldü. */
  onDone: (skipped: boolean) => void;
}

export interface EndingFlow {
  readonly active: boolean;
  start: () => void;
  skip: () => void;
  /** Geliştirme/test kancaları. */
  debug: { beat: () => string | null; skipTo: (id: string) => void };
}

/** Yaratığın takibi (sn): 150 m'den ~55 m'ye kadar. */
const FOLLOW_SECONDS = 20;

export function createEndingFlow(d: EndingDeps): EndingFlow {
  const { stage, audio } = d;
  let director = new PrologueDirector(d.def);
  let active = false;
  let finishing = false;

  const fade = document.createElement('div');
  fade.className = 'fade';
  d.ui.appendChild(fade);
  const bars = document.createElement('div');
  bars.className = 'cinema-bars';
  bars.hidden = true;
  bars.innerHTML = '<i></i><i></i><button class="ghost ending-skip" data-act="skip-ending">Atla ›</button>';
  d.ui.appendChild(bars);
  bars.querySelector('button')!.addEventListener('click', () => skip());

  const setFade = (on: boolean, seconds = 0.6, white = false) => {
    fade.style.transitionDuration = `${seconds}s`;
    fade.classList.toggle('flash', white);
    fade.classList.toggle('on', on);
  };
  const later = (ms: number, fn: () => void) => window.setTimeout(() => active && fn(), ms);

  const cues: Record<EndingCue, () => void> = {
    capsule: () => {
      stage.enter();
      setFade(false, 1.4);
    },
    launch: () => {
      stage.launch();
      audio.play('jam', { volume: 0.9 });
      audio.play('splash', { volume: 0.45, delay: 0.25 });
      stage.shake(1.2, 0.05);
    },
    radio: () => audio.synth.radio(1.6, 0.7),
    lightsOut: () => {
      stage.lightsOut(11);
      for (const t of [2, 4.6, 6.9, 9]) audio.play('switch', { volume: 0.35, delay: t });
    },
    sonarContact: () => {
      stage.status.sonar = 'contact';
      audio.play('sonar', { volume: 0.6 });
      later(5200, () => audio.play('sonar', { volume: 0.5 }));
    },
    creatureFollow: () => {
      stage.creatureFollow(FOLLOW_SECONDS);
      later(2500, () => audio.play('rumble', { volume: 0.5 }));
    },
    sonarLost: () => {
      stage.status.sonar = 'lost';
    },
    searchlight: () => stage.searchlight(4),
    boat: () => stage.boat(12),
    'look:console': () => stage.look('console'),
    'look:station': () => stage.look('station'),
    'look:creature': () => stage.look('creature'),
    'look:up': () => stage.look('up'),
    'look:ship': () => stage.look('ship'),
    'look:boat': () => stage.look('boat'),
  };

  const apply = (fx: Effect[]) => {
    for (const e of fx) {
      if (e.type === 'cue') cues[e.name as EndingCue]?.();
      else if (e.type === 'say') d.subtitles.say(d.spoken(e.lines));
      else if (e.type === 'done') finish(false);
    }
  };

  stage.onEvent((name) => {
    if (!active) return;
    if (name === 'surfacing') setFade(true, 0.35, true);
    if (name === 'surfaced') {
      audio.play('splash', { volume: 0.9 });
      stage.shake(0.8, 0.06);
      setFade(false, 1.6, true);
    }
    apply(director.on({ type: 'event', name }));
  });
  d.subtitles.onIdle(() => active && apply(director.on({ type: 'linesDone' })));
  let last = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!active) return;
    // Derinlik eşiği: düzey tetiklemeli (sahne eşik geçildikten sonra başlasa da ilerler)
    const u = director.beat?.until;
    const th = u?.type === 'event' ? depthEvent(u.name) : null;
    if (th !== null && u?.type === 'event' && stage.status.depth <= th) apply(director.on({ type: 'event', name: u.name }));
    apply(director.on({ type: 'tick', dt }));
  }, 100);

  function finish(skipped: boolean): void {
    if (!active || finishing) return;
    finishing = true;
    d.subtitles.clear();
    setFade(true, 0.8);
    window.setTimeout(() => {
      active = false;
      finishing = false;
      stage.leave();
      bars.hidden = true;
      document.body.classList.remove('cinematic');
      setFade(false, 1);
      d.onDone(skipped);
    }, 900);
  }
  function skip(): void {
    finish(true);
  }

  return {
    get active() {
      return active;
    },
    start() {
      director = new PrologueDirector(d.def);
      active = true;
      d.subtitles.clear(); // odaya giriş gibi önceki replikler sahneye taşmasın
      document.body.classList.add('cinematic');
      bars.hidden = false;
      setFade(true, 0.8);
      later(900, () => apply(director.start()));
    },
    skip,
    debug: {
      beat: () => (active ? (director.beat?.id ?? null) : null),
      skipTo: (id) => {
        d.subtitles.clear();
        const i = d.def.beats.findIndex((b) => b.id === id);
        if (i < 0) throw new Error(`final: sahne yok (${id})`);
        // Önceki sahnenin beklediği olaya göre derinlik
        if (!stage.entered) cues.capsule();
        if (i > 1 && !stage.launched) stage.launch();
        const prev = i > 0 ? d.def.beats[i - 1].until : null;
        const th = prev?.type === 'event' ? depthEvent(prev.name) : null;
        if (th !== null) stage.setDepth(th);
        else if (prev?.type === 'event' && prev.name === 'creature:stop') stage.setDepth(112);
        else if (i > 0 && d.def.beats.slice(0, i).some((b) => b.until.type === 'event' && b.until.name === 'surfaced')) stage.setDepth(0);
        apply(director.skipTo(id));
      },
    },
  };
}
