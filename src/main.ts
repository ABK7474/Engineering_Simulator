// Bağlama: hub ↔ bulmaca ↔ çözücü ↔ olay raporu ↔ ses.

import './style.css';
import fault from '../content/faults/door-power-01.json';
import { mountAudioControls, loadSettings } from './audio/controls';
import { AudioEngine } from './audio/engine';
import { createRng } from './core/rng';
import type { FaultCard } from './core/types';
import { createHub } from './hub/hub';
import { showIncidentReport } from './puzzles/incident-report/report';
import { openSeriesCircuitPanel } from './puzzles/series-circuit/panel';
import { parseSeriesLedConfig, solveSeriesLed } from './solvers/circuit/series-led';
import { generateSeriesLed } from './solvers/circuit/series-led.generate';
import { resolveOutcome } from './solvers/circuit/series-led.outcomes';
import { buildSeriesLedReport } from './solvers/circuit/series-led.report';

const card = fault as FaultCard;
const stage = card.stages[0];
const config = parseSeriesLedConfig(stage.config);
const ASSETS = `${import.meta.env.BASE_URL}assets/`;
/** Onarımdan sonra gerilim müziğinin sakine dönüş süresi (s). */
const CALM_DOWN_SECONDS = 8;

// ?seed=123 ile tekrarlanabilir oturum (hata ayıklama için).
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const baseSeed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : Math.floor(Math.random() * 2 ** 31);
let attempt = 0;
let problem = generateSeriesLed(config, baseSeed);

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;

const audio = new AudioEngine(ASSETS);
const settings = loadSettings();
audio.applySettings(settings);
mountAudioControls(ui, settings, (s) => audio.applySettings(s));
const audioReady = audio.load().catch((e) => console.error('Sesler yüklenemedi; oyun sessiz devam ediyor.', e));

const uiSound = (s: 'click' | 'switch') => audio.play(s, { volume: 0.7 });

const hub = await createHub(app, {
  assetBase: ASSETS,
  sounds: audio,
  onInteract: openPuzzle,
  onStart: () => void audioReady.then(() => audio.start()),
});

if (import.meta.env.DEV) Object.assign(window, { __dm: { audio, hub } });

function openPuzzle(): void {
  uiSound('click');
  hub.suspend();
  openSeriesCircuitPanel(ui, {
    title: card.title,
    briefing: card.briefing,
    problem,
    onSound: uiSound,
    onCancel: () => hub.resume(),
    onSubmit: (choiceId) => void runAttempt(choiceId),
  });
}

async function runAttempt(choiceId: string): Promise<void> {
  const choice = problem.choices.find((c) => c.id === choiceId)!;
  const sol = solveSeriesLed(problem.spec.vs, problem.spec.led.model, choice.r);
  const outcome = resolveOutcome(problem.spec, sol, createRng(problem.seed * 31 + attempt));
  const result = buildSeriesLedReport(stage.id, problem, choiceId, outcome);

  // Hata: gerilim müziği yükselir ve onarıma kadar kalır.
  if (outcome.kind !== 'success') audio.setTension(1, 2);
  await hub.applyOutcome(outcome);

  const repair = () => {
    // Yeni deneme yeni sayılarla gelir: rapordaki cevabı ezberlemek işe yaramasın.
    attempt++;
    problem = generateSeriesLed(config, baseSeed + attempt);
    hub.repairForRetry();
    audio.setTension(0, CALM_DOWN_SECONDS);
  };

  showIncidentReport(ui, result, {
    onSound: uiSound,
    onRetry: () => {
      repair();
      openPuzzle();
    },
    onClose: () => {
      if (!result.success) repair();
      hub.resume();
    },
  });
}
