// Prolog akışı: sahne durum makinesini (story/prologue.ts) hub'ın prolog sahnesine, altyazıya, sese ve bulmaca
// panellerine bağlar. Müren'in kendi O₂/Güç'ü vardır (gerçek denge kuralları, istasyondan ayrı); kritikte bölüm
// kapanmaz, yedek hücreye geçilir. Bitince (ya da atlanınca) istasyondaki oyun başlar.

import type { AudioEngine } from './audio/engine';
import { applyOutcome, createResources, isCritical, type Balance, type ResourceState } from './core/resources';
import { createRng } from './core/rng';
import type { StageDef } from './core/types';
import type { Hub, PrologueStage } from './hub/hub';
import { showIncidentReport } from './puzzles/incident-report/report';
import { prepareStage, type StageRun } from './puzzles/stages';
import type { Line, Spoken } from './story/lines';
import { PrologueDirector, type Effect, type PrologueDef } from './story/prologue';
import type { Subtitles } from './ui/subtitle';

export interface PrologueDeps {
  hub: Hub;
  stage: PrologueStage;
  def: PrologueDef;
  stages: Record<string, StageDef[]>;
  ui: HTMLElement;
  subtitles: Subtitles;
  spoken: (lines: readonly Line[]) => Spoken[];
  audio: AudioEngine;
  balance: Balance;
  seed: number;
  uiSound: (s: 'click' | 'switch') => void;
  /** İpucu düğmesi (son açılan panele; prologda ücretsiz). */
  attachHints: (hints: string[]) => void;
  /** HUD'da gösterilecek kaynaklar (prologda Müren'inkiler; null = istasyon). */
  showResources: (r: ResourceState | null) => void;
  /** Prolog bitti ya da atlandı: istasyon oyunu başlar. */
  onDone: (skipped: boolean) => void;
}

export interface PrologueFlow {
  readonly active: boolean;
  /** Giriş ekranının arkasında kokpit görünsün diye yükleme sırasında. */
  prepare: () => void;
  start: () => void;
  skip: () => void;
  /** Geliştirme/test kancaları. */
  debug: { beat: () => string | null; skipTo: (id: string) => void; solve: () => void; interact: (t: string) => void };
}

const OXYGEN = 'oxygen';
const POWER = 'power';

export function createPrologueFlow(d: PrologueDeps): PrologueFlow {
  const director = new PrologueDirector(d.def);
  const { stage, hub, audio } = d;
  let active = false;
  let res = createResources(d.balance);
  let attempt = 0;
  let o2Drain = 0;
  let current: { card: string; run: StageRun; def: StageDef } | null = null;

  // Karartma ve kask katmanları (DOM)
  const fade = document.createElement('div');
  fade.className = 'fade';
  d.ui.appendChild(fade);
  const helmet = document.createElement('div');
  helmet.className = 'helmet';
  helmet.hidden = true;
  helmet.innerHTML = '<div class="helmet-glass"></div><div class="helmet-gauge"><span>TÜP</span><b>100</b>%</div>';
  d.ui.appendChild(helmet);
  const setFade = (on: boolean, seconds = 0.6) => {
    fade.style.transitionDuration = `${seconds}s`;
    fade.classList.toggle('on', on);
  };

  const sync = () => {
    stage.status.o2 = (res.values[OXYGEN] / d.balance.resources[OXYGEN].max) * 100;
    stage.status.power = (res.values[POWER] / d.balance.resources[POWER].max) * 100;
    helmet.querySelector('b')!.textContent = String(Math.round(stage.status.o2));
    d.showResources(res);
  };
  const reserveIfCritical = () => {
    if (!isCritical(res, d.balance)) return;
    for (const id of Object.keys(res.values)) res.values[id] = Math.max(res.values[id], d.balance.resources[id].max * 0.4);
    res = { ...res, damages: [] };
    if (d.def.reserve?.length) d.subtitles.say(d.spoken(d.def.reserve));
  };

  const later = (ms: number, fn: () => void) => window.setTimeout(() => active && fn(), ms);

  const cues: Record<string, () => void> = {
    cockpit: () => {
      stage.setRig('cockpit');
      stage.setCabinLight('normal');
    },
    descent: () => {
      if (stage.rig === 'cockpit') stage.setMurenPhase('descent');
    },
    sonarContact: () => {
      stage.status.sonar = 'contact';
      audio.play('sonar', { volume: 0.6 });
      later(4500, () => stage.status.sonar === 'contact' && (stage.status.sonar = 'idle'));
    },
    creaturePass: () => {
      stage.creaturePass();
      later(1800, () => audio.play('rumble', { volume: 0.45 }));
    },
    static: () => audio.synth.radio(2.6, 0.8),
    beacon: () => {
      stage.status.sonar = 'beacon';
      later(1500, () => audio.synth.radio(1.6, 0.6));
    },
    wave: () => {
      audio.synth.radio(2.4, 1);
      audio.play('fuse', { volume: 0.5 });
      stage.setCabinLight('flicker');
      stage.shake(1.2, 0.03);
      res.values[POWER] = Math.max(d.balance.critical + 5, res.values[POWER] - 40);
      stage.status.ballast = 'none';
      sync();
      later(2600, () => stage.setCabinLight('normal'));
    },
    radioCut: () => audio.synth.radio(1.4, 1),
    sink: () => {
      stage.setMurenPhase('sink');
      stage.status.alarm = true;
      stage.setCabinLight('alarm');
      audio.alarm(8);
      audio.synth.creak();
      later(3000, () => audio.synth.creak());
      later(5600, () => audio.synth.creak());
    },
    crash: () => {
      if (stage.rig === 'cockpit' && stage.status.alarm === false) stage.setMurenPhase('wreck');
      stage.status.alarm = true;
      stage.setCabinLight('alarm');
    },
    o2drain: () => {
      o2Drain = 2.2; // %/s
    },
    suitUp: () => {
      o2Drain = 0;
      setFade(true, 0.8);
      audio.play('switch');
      later(900, () => {
        helmet.hidden = false;
        audio.synth.setBreath(true);
        res.values[OXYGEN] = d.balance.resources[OXYGEN].max; // kıyafetin tüpü
        sync();
      });
    },
    seabed: () => {
      stage.setRig('seabed');
      stage.setCabinLight('off');
      helmet.hidden = false;
      audio.synth.setBreath(true);
      setFade(false, 1.2);
    },
    enterStation: () => {
      void stage.enterStation().then(() => {
        apply(director.on({ type: 'event', name: 'inside' }));
        audio.play('splash', { volume: 0.7 });
        helmet.hidden = true;
        audio.synth.setBreath(false);
        setFade(false, 0.8);
      });
      later(1300, () => setFade(true, 0.5));
    },
  };

  const apply = (fx: Effect[]) => {
    for (const e of fx) {
      if (e.type === 'cue') cues[e.name]?.();
      else if (e.type === 'say') d.subtitles.say(d.spoken(e.lines));
      else if (e.type === 'prompt') stage.setPrompt(e.target, e.text);
      else if (e.type === 'openPuzzle') openPuzzle(e.card);
      else if (e.type === 'done') finish(false);
    }
  };

  const runFor = (card: string) => {
    if (current?.card === card) return current;
    const def = d.stages[card][0];
    current = { card, def, run: prepareStage(def, d.seed + attempt * 7 + card.length) };
    return current;
  };

  const evaluate = (card: string, answer: unknown) => {
    const { run } = runFor(card);
    const { outcome, result } = run.evaluate(answer, createRng(d.seed * 13 + attempt));
    const step = applyOutcome(res, d.balance, `prologue:${card}`, outcome);
    res = step.state;
    const success = outcome.kind === 'success';
    if (!success) {
      audio.sparks(0.4);
      stage.setCabinLight('flicker');
      later(1200, () => stage.setCabinLight(stage.status.alarm ? 'alarm' : 'normal'));
      result.facts.push({ label: 'Müren', value: 'Hücreler hasar aldı (O₂/Güç); yeni parçayla tekrar dene' });
    } else {
      audio.play('switch');
      if (card === 'prologue-relay-01') stage.status.relayOk = true;
      if (card === 'prologue-bus-01') {
        stage.status.pumpOk = true;
        stage.status.ballast = 'rejected';
        res.values[POWER] = Math.max(res.values[POWER], 70);
      }
    }
    reserveIfCritical();
    sync();
    return { success, result };
  };

  const finishPuzzle = (card: string, success: boolean) => {
    attempt++;
    current = null;
    hub.resume();
    apply(director.on({ type: 'puzzle', card, success }));
  };

  function openPuzzle(card: string): void {
    d.uiSound('click');
    hub.suspend();
    const { run, def } = runFor(card);
    run.open({
      root: d.ui,
      title: `Müren — ${def.title}`,
      briefing: def.briefing,
      onSound: d.uiSound,
      onCancel: () => {
        director.puzzleClosed();
        hub.resume();
      },
      onSubmit: (answer) => {
        const { success, result } = evaluate(card, answer);
        showIncidentReport(d.ui, result, {
          onSound: d.uiSound,
          onClose: () => finishPuzzle(card, success),
        });
      },
    });
    d.attachHints(run.hints);
  }

  function finish(skipped: boolean): void {
    if (!active && !skipped) return;
    active = false;
    o2Drain = 0;
    stage.setPrompt(null);
    helmet.hidden = true;
    audio.synth.setBreath(false);
    setFade(false, 0.6);
    if (stage.rig !== 'station') stage.setRig('station');
    stage.setMurenPhase('wreck');
    d.showResources(null);
    d.onDone(skipped);
  }

  // Altyazı kuyruğu bitince sahne ilerleyebilir; zaman sahneleri ve oksijen sızıntısı
  d.subtitles.onIdle(() => active && apply(director.on({ type: 'linesDone' })));
  let last = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!active) return;
    if (o2Drain > 0) {
      res.values[OXYGEN] = Math.max(d.balance.critical + 2, res.values[OXYGEN] - o2Drain * dt);
      sync();
    }
    // Tabanda kıyafetin tüpü yavaşça azalır (gösterge yaşasın, tehlike olmasın)
    if (stage.rig === 'seabed') {
      res.values[OXYGEN] = Math.max(60, res.values[OXYGEN] - 0.4 * dt);
      sync();
    }
    apply(director.on({ type: 'tick', dt }));
  }, 100);
  stage.onImpact(() => {
    if (!active) return;
    stage.shake(1.6, 0.14);
    audio.play('jam', { volume: 1 });
    audio.play('fuse', { volume: 0.6 });
    audio.play('splash', { volume: 0.5, delay: 0.3 });
    stage.status.depth = 221;
    apply(director.on({ type: 'event', name: 'impact' }));
  });

  return {
    get active() {
      return active;
    },
    prepare() {
      stage.setRig('cockpit');
      stage.setMurenPhase('descent');
      sync();
    },
    start() {
      active = true;
      res = createResources(d.balance);
      sync();
      apply(director.start());
    },
    skip() {
      d.subtitles.clear();
      finish(true);
    },
    debug: {
      beat: () => (active ? (director.beat?.id ?? null) : null),
      skipTo: (id) => {
        d.subtitles.clear();
        apply(director.skipTo(id));
      },
      solve: () => {
        const b = director.beat;
        if (!b || b.until.type !== 'puzzle') return;
        d.ui.querySelectorAll('.overlay').forEach((o) => o.remove());
        const card = b.until.card;
        const { success } = evaluate(card, structuredClone(runFor(card).run.solution));
        director.puzzleOpen = false;
        finishPuzzle(card, success);
      },
      interact: (t) => apply(director.on({ type: 'interact', target: t })),
    },
  };
}
