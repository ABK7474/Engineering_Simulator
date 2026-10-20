// Bağlama: hub ↔ bulmaca ↔ çözücü ↔ olay raporu ↔ ses ↔ kaynaklar ↔ ilerleme.
// Hub ve 2D paneller kaynakları bilmez; bedel ve geri kazanım burada core/resources ile uygulanır.

import './style.css';
import balanceJson from '../content/balance/resources.json';
import fault from '../content/faults/door-power-01.json';
import { mountAudioControls, loadSettings } from './audio/controls';
import { AudioEngine } from './audio/engine';
import { tensionChanged } from './audio/mix';
import { fromExportJson, loadProgress, openProgressStore, toExportJson } from './core/progress';
import {
  anyLow,
  applyOutcome,
  drainPerMinute,
  isCritical,
  level,
  parseBalance,
  resetEpisode,
  tensionFor,
  tick,
  type Amounts,
  type ResourceEvent,
} from './core/resources';
import { createRng } from './core/rng';
import type { FaultCard } from './core/types';
import { createHub } from './hub/hub';
import { showIncidentReport } from './puzzles/incident-report/report';
import { openSeriesCircuitPanel } from './puzzles/series-circuit/panel';
import { parseSeriesLedConfig, solveSeriesLed } from './solvers/circuit/series-led';
import { generateSeriesLed } from './solvers/circuit/series-led.generate';
import { resolveOutcome } from './solvers/circuit/series-led.outcomes';
import { buildSeriesLedReport } from './solvers/circuit/series-led.report';
import { mountBackupMenu } from './ui/backup';
import { showEpisodeClosed } from './ui/episode-closed';
import { mountHud } from './ui/hud';

const card = fault as FaultCard;
const stage = card.stages[0];
const FAULT_ID = card.id;
const config = parseSeriesLedConfig(stage.config);
const balance = parseBalance(balanceJson);
const ASSETS = `${import.meta.env.BASE_URL}assets/`;
/** Onarımdan sonra müziğin kaynak seviyesine dönüş süresi (s). */
const CALM_DOWN_SECONDS = 8;
const ALARM_SECONDS = 4.5;
const SAVE_EVERY_MS = 5000;

// ?seed=123 ile tekrarlanabilir oturum (hata ayıklama için).
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const baseSeed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : Math.floor(Math.random() * 2 ** 31);
let attempt = 0;
let problem = generateSeriesLed(config, baseSeed);

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;

// --- İlerleme ---
const store = await openProgressStore();
let progress = await loadProgress(store, balance);
let lastSave = 0;
const persist = async () => {
  progress.savedAt = new Date().toISOString();
  lastSave = performance.now();
  try {
    await store.save(progress);
  } catch (e) {
    console.warn('İlerleme kaydedilemedi.', e);
  }
};

// --- Ses ---
const audio = new AudioEngine(ASSETS);
const settings = loadSettings();
audio.applySettings(settings);
mountAudioControls(ui, settings, (s) => audio.applySettings(s));
const audioReady = audio.load().catch((e) => console.error('Sesler yüklenemedi; oyun sessiz devam ediyor.', e));
const uiSound = (s: 'click' | 'switch') => audio.play(s, { volume: 0.7 });

// --- HUD ve yedek menüsü ---
const hud = mountHud(ui);
const renderHud = () => {
  const drain = drainPerMinute(progress.resources, balance);
  hud.render({
    rows: Object.entries(balance.resources).map(([id, def]) => ({
      id,
      label: def.label,
      value: progress.resources.values[id],
      max: def.max,
      level: level(balance, progress.resources.values[id]),
      drainPerMinute: drain[id],
    })),
    damages: [...new Set(progress.resources.damages.map((d) => d.label))],
    episode: progress.episode,
  });
};
renderHud();
mountBackupMenu(ui, {
  exportJson: () => toExportJson(progress),
  importJson: async (text) => {
    progress = fromExportJson(text, balance);
    await persist();
    location.reload();
  },
});

const hub = await createHub(app, {
  assetBase: ASSETS,
  sounds: audio,
  onInteract: openPuzzle,
  onStart: () => void audioReady.then(() => audio.start()),
});

// --- Gerilim ve uyarı ışığı: hata darbesi (onarıma kadar) ya da kaynakların durumu ---
let failurePulse = false;
let lastTension = -1;
const updateMood = (seconds = 2) => {
  const target = Math.max(failurePulse ? 1 : 0, tensionFor(progress.resources, balance));
  if (tensionChanged(lastTension, target)) {
    audio.setTension(target, seconds);
    lastTension = target;
  }
  hub.setWarningLight(failurePulse || anyLow(progress.resources, balance));
};

const fmtAmounts = (a: Amounts, sign: '−' | '+') =>
  Object.entries(a)
    .filter(([, v]) => v > 0.05)
    .map(([id, v]) => `${balance.resources[id].label} ${sign}${(Math.round(v * 10) / 10).toString().replace('.', ',')}`)
    .join(' · ');

let closing = false;
function closeEpisode(): void {
  if (closing) return;
  closing = true;
  hub.suspend();
  const [id, value] = Object.entries(progress.resources.values).sort((a, b) => a[1] - b[1])[0];
  showEpisodeClosed(ui, {
    reason: `${balance.resources[id].label} %${Math.floor(value)} — kritik seviye`,
    episode: progress.episode,
    attempts: progress.attemptsThisEpisode,
    worst: progress.worstEvent?.label ?? null,
    onRestart: () => {
      progress.resources = resetEpisode(progress.resources, balance);
      progress.episode++;
      progress.attemptsThisEpisode = 0;
      progress.worstEvent = null;
      progress.faults[FAULT_ID] = { repaired: false };
      attempt++;
      problem = generateSeriesLed(config, baseSeed + attempt);
      failurePulse = false;
      hub.resetEpisode();
      renderHud();
      updateMood(3);
      void persist();
      closing = false;
      hub.resume();
    },
  });
}

// Koridorda tüketimden gelen olaylar (hata anındaki olaylar için siren zaten hub'da çalar).
function onDrainEvents(events: ResourceEvent[]): void {
  if (events.some((e) => e.type === 'crossedWarning' || e.type === 'critical')) audio.alarm(ALARM_SECONDS);
  if (events.some((e) => e.type === 'critical')) {
    void persist();
    closeEpisode();
  }
}

// --- Kayıttan geri yükleme ---
if (progress.faults[FAULT_ID]?.repaired) hub.restoreSolved();
hub.restoreScars(progress.scars);
updateMood(0.1);
if (isCritical(progress.resources, balance)) closeEpisode();

// --- Kalıcı hasar tüketimi: oyun saatiyle, yalnız koridorda dolaşırken ---
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(1, (now - lastTick) / 1000);
  lastTick = now;
  if (closing || !hub.isRoaming()) return;
  const step = tick(progress.resources, balance, dt);
  if (step.state === progress.resources) return;
  progress.resources = step.state;
  renderHud();
  updateMood();
  onDrainEvents(step.events);
  if (now - lastSave > SAVE_EVERY_MS) void persist();
}, 250);

if (import.meta.env.DEV) {
  Object.assign(window, {
    __dm: {
      audio,
      hub,
      progress: () => structuredClone(progress),
      setResources: (values: Amounts) => {
        progress.resources = { ...progress.resources, values: { ...progress.resources.values, ...values } };
        renderHud();
        updateMood();
      },
    },
  });
}

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

  // Bedel ya da geri kazanım: çözücünün fiziksel sonucundan.
  progress.attemptsThisEpisode++;
  const step = applyOutcome(progress.resources, balance, FAULT_ID, outcome);
  progress.resources = step.state;
  const lost: Amounts = {};
  for (const e of step.events) {
    if (e.type === 'damage') for (const [id, v] of Object.entries(e.loss)) lost[id] = (lost[id] ?? 0) + v;
    if (e.type === 'repaired') result.facts.push({ label: 'Kaynak etkisi', value: fmtAmounts(e.gain, '+') });
  }
  const damage = step.events.find((e) => e.type === 'damage');
  if (damage) {
    result.facts.push({ label: 'Kaynak etkisi', value: fmtAmounts(lost, '−') });
    const total = Object.values(lost).reduce((a, b) => a + b, 0);
    if (!progress.worstEvent || total > progress.worstEvent.total) progress.worstEvent = { label: damage.label, total };
  }
  progress.faults[FAULT_ID] = { repaired: outcome.kind === 'success' };
  failurePulse = outcome.kind !== 'success';
  const critical = isCritical(progress.resources, balance);
  if (critical) result.facts.push({ label: 'Durum', value: 'Kaynaklar kritik — bölüm kapanacak' });
  renderHud();
  updateMood(outcome.kind === 'success' ? CALM_DOWN_SECONDS : 2);
  void persist();

  await hub.applyOutcome(outcome);
  if (hub.hasScorch() && !progress.scars.panelScorch) {
    progress.scars.panelScorch = true;
    void persist();
  }

  const repair = () => {
    // Yedek parça: yeni deneme yeni sayılarla; kalıcı hasar onarılana kadar sürer.
    attempt++;
    problem = generateSeriesLed(config, baseSeed + attempt);
    hub.repairForRetry();
    failurePulse = false;
    updateMood(CALM_DOWN_SECONDS);
  };

  showIncidentReport(ui, result, {
    onSound: uiSound,
    onRetry: critical
      ? undefined
      : () => {
          repair();
          openPuzzle();
        },
    onClose: () => {
      if (critical) return closeEpisode();
      if (!result.success) repair();
      hub.resume();
    },
  });
}
