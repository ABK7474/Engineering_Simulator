// Bağlama: hub ↔ bulmaca ↔ çözücü ↔ olay raporu ↔ ses ↔ kaynaklar ↔ ilerleme.
// Hub ve 2D paneller kaynakları bilmez; bedel ve geri kazanım burada core/resources ile uygulanır.

import './style.css';
import balanceJson from '../content/balance/resources.json';
import coursesJson from '../content/courses.json';
import fault from '../content/faults/door-power-01.json';
import { mountAudioControls, loadSettings } from './audio/controls';
import { AudioEngine } from './audio/engine';
import { tensionChanged } from './audio/mix';
import { openKv } from './core/kv';
import {
  approveTopic,
  flagTemplate,
  loadLibrary,
  removeTopic,
  saveLibrary,
  templatePool,
  upsertTopic,
  validateLibrary,
  type Library,
} from './core/library';
import {
  defaultProgress,
  fromExportJson,
  libraryFromExportJson,
  loadProgress,
  progressStore,
  stageKey,
  toExportJson,
} from './core/progress';
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
import { clearApiKey, getApiKey, getModel, maskKey, setApiKey, setModel } from './core/secrets';
import type { FaultCard, StageDef } from './core/types';
import { createHub } from './hub/hub';
import { showIncidentReport } from './puzzles/incident-report/report';
import { prepareStage, validateStage, type StageRun } from './puzzles/stages';
import { getProvider, LLM_DEFAULTS, type LlmSettings } from './llm/llm';
import { createTopicDraft, generateTopicTemplates, type Course } from './pipeline/topic-pipeline';
import { mountBackupMenu } from './ui/backup';
import { showEpisodeClosed } from './ui/episode-closed';
import { mountHud } from './ui/hud';
import { openLibraryView } from './ui/library-view';
import { openSettings } from './ui/settings';
import { openTopicFlow } from './ui/topic-flow';

const card = fault as FaultCard;
const FAULT_ID = card.id;
const STAGES = card.stages;
STAGES.forEach(validateStage); // içerik hatası açılışta yakalansın
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

const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;

// --- İlerleme ---
const kv = await openKv();
const store = progressStore(kv);
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
// --- Konu kütüphanesi ve içerik hattı (LLM yalnız burada; oyun sırasında çağrılmaz) ---
const COURSES = coursesJson as Course[];
const BASES = Object.fromEntries(STAGES.map((s) => [s.type, s])) as Record<StageDef['type'], StageDef>;
/** Yüklenen kütüphanedeki şablonlar yeniden doğrulanır; geçersiz olan oyuna girmez. */
function sanitize(lib: Library): Library {
  return {
    ...lib,
    topics: lib.topics.map((t) => ({
      ...t,
      templates: t.templates.filter((x) => {
        try {
          validateStage(x.stage);
          return true;
        } catch (e) {
          console.warn(`Geçersiz şablon atlandı (${x.stage.id}):`, (e as Error).message);
          return false;
        }
      }),
    })),
  };
}
let library = sanitize(await loadLibrary(kv));
const persistLibrary = async () => {
  try {
    await saveLibrary(kv, library);
  } catch (e) {
    console.warn('Konu kütüphanesi kaydedilemedi.', e);
  }
};
const MOCK_LLM = new URLSearchParams(location.search).get('llm') === 'mock';
const llmSettings = (): LlmSettings => ({ apiKey: getApiKey(), model: getModel(LLM_DEFAULTS.model), mock: MOCK_LLM });
const providerLabel = () => (MOCK_LLM ? 'Sahte istemci' : `${LLM_DEFAULTS.label} · ${getModel(LLM_DEFAULTS.model)}`);
/** Menüden açılan ekranlar: koridordaki girdiyi askıya alır, kapanınca geri verir. */
const withHubPaused = (open: (onClose: () => void) => void) => {
  hub.suspend();
  open(() => {
    prepareCurrent(); // yeni ya da silinen şablonlar sıradaki aşamaya yansısın
    hub.resume();
  });
};

mountBackupMenu(ui, {
  items: [
    {
      label: 'Konu ekle…',
      onClick: () =>
        withHubPaused((onClose) =>
          openTopicFlow(ui, {
            courses: COURSES,
            providerLabel,
            keyAdvice: LLM_DEFAULTS.keyAdvice,
            // Sahte istemci anahtarı kullanmaz ama akış (ve sızıntı denetimi) gerçeğiyle aynı kalsın.
            needsKey: () => !getApiKey(),
            saveKey: setApiKey,
            createDraft: (input) => createTopicDraft(llmSettings(), input),
            approve: async (t, edits) => {
              const approved = approveTopic(t, edits);
              library = upsertTopic(library, approved);
              await persistLibrary();
              return approved;
            },
            generate: async (t) => {
              const existing = library.topics.flatMap((x) => x.templates.map((y) => y.stage));
              const done = await generateTopicTemplates(llmSettings(), t, { course: COURSES.find((c) => c.id === t.courseId)!, bases: BASES, existing });
              library = upsertTopic(library, done);
              await persistLibrary();
              return done;
            },
            onClose,
          }),
        ),
    },
    {
      label: 'Konu kütüphanesi',
      onClick: () =>
        withHubPaused((onClose) =>
          openLibraryView(ui, () => library, {
            remove: async (id) => {
              library = removeTopic(library, id);
              await persistLibrary();
            },
            onClose,
          }),
        ),
    },
    {
      label: 'Ayarlar…',
      onClick: () =>
        withHubPaused((onClose) =>
          openSettings(ui, {
            providerLabel: LLM_DEFAULTS.label,
            defaultModel: LLM_DEFAULTS.model,
            keyAdvice: LLM_DEFAULTS.keyAdvice,
            mock: MOCK_LLM,
            maskedKey: () => maskKey(getApiKey()),
            saveKey: setApiKey,
            clearKey: clearApiKey,
            model: () => getModel(LLM_DEFAULTS.model),
            saveModel: setModel,
            testConnection: async () => {
              try {
                return await getProvider(llmSettings()).testConnection();
              } catch (e) {
                return { ok: false, message: (e as Error).message };
              }
            },
            onClose,
          }),
        ),
    },
  ],
  exportJson: () => toExportJson(progress, library),
  importJson: async (text) => {
    const imported = fromExportJson(text, balance);
    const rawLib = libraryFromExportJson(text);
    if (rawLib !== undefined) {
      const lib = validateLibrary(rawLib);
      if (!lib) throw new Error('Yedekteki konu kütüphanesi bozuk ya da bu sürümle uyumsuz.');
      library = lib;
      await persistLibrary();
    }
    progress = imported;
    await persist();
    location.reload();
  },
  reset: async () => {
    progress = defaultProgress(balance);
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

// --- Arıza zinciri: ardışık aşamalar ---
const stagesDone = () => progress.faults[FAULT_ID]?.stagesDone ?? 0;
const currentIndex = () => Math.min(stagesDone(), STAGES.length - 1);
const allDone = () => stagesDone() >= STAGES.length;
const progressText = (done: number) => `AŞAMA ${done}/${STAGES.length}\nTAMAM`;
/** Aşama problemi: tohum taban + deneme + aşama; ?seed ile tekrarlanabilir. */
const stageSeed = () => baseSeed + attempt + 1000 * currentIndex();
/**
 * Aşamanın tanımı: kullanıcının onaylı konularından o türde şablon varsa onlardan biri (kendi
 * notundan çalışsın diye öncelikli), yoksa yerleşik içerik. Seçim aşama tohumuyla belirlenir.
 */
const pickStageDef = (): StageDef => {
  const base = STAGES[currentIndex()];
  const pool = templatePool(library, base.type);
  return pool.length ? pool[stageSeed() % pool.length] : base;
};
let currentDef = pickStageDef();
let run: StageRun = prepareStage(currentDef, stageSeed());
function prepareCurrent(): void {
  currentDef = pickStageDef();
  run = prepareStage(currentDef, stageSeed());
}
const showStageProgress = () => hub.showProgress(!allDone() && stagesDone() > 0 ? progressText(stagesDone()) : null);

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
      progress.faults[FAULT_ID] = { stagesDone: 0 };
      attempt++;
      prepareCurrent();
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
if (allDone()) hub.restoreSolved();
else showStageProgress();
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
      stage: () => ({ index: currentIndex(), baseSeed, attempt, seed: stageSeed(), def: structuredClone(currentDef) }),
      library: () => structuredClone(library),
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
  const i = currentIndex();
  const def = currentDef;
  run.open({
    root: ui,
    title: `${card.title} — Aşama ${i + 1}/${STAGES.length}: ${def.title}`,
    briefing: def.briefing,
    source: def.source && {
      label: `${def.source.topicName} (${def.source.courseName})`,
      onFlag: () => {
        // "Bu soru hatalı": şablon havuzdan çıkar; aşama başka bir problemle hazırlanır.
        library = flagTemplate(library, def.id);
        void persistLibrary();
        prepareCurrent();
        hub.resume();
      },
    },
    onSound: uiSound,
    onCancel: () => hub.resume(),
    onSubmit: (answer) => void runAttempt(answer),
  });
}

async function runAttempt(answer: unknown): Promise<void> {
  const i = currentIndex();
  const { outcome, result } = run.evaluate(answer, createRng(baseSeed * 31 + attempt + 7 * i));
  const success = outcome.kind === 'success';
  const final = success && i + 1 === STAGES.length;

  // Bedel ya da geri kazanım: çözücünün fiziksel sonucundan; hasar bu aşamaya bağlanır.
  progress.attemptsThisEpisode++;
  const step = applyOutcome(progress.resources, balance, stageKey(FAULT_ID, i), outcome);
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
  if (success) progress.faults[FAULT_ID] = { stagesDone: i + 1 };
  failurePulse = !success;
  const critical = isCritical(progress.resources, balance);
  if (critical) result.facts.push({ label: 'Durum', value: 'Kaynaklar kritik — bölüm kapanacak' });
  renderHud();
  updateMood(success ? CALM_DOWN_SECONDS : 2);
  void persist();

  await hub.applyOutcome(outcome, { final, progressText: progressText(i + 1) });
  if (hub.hasScorch() && !progress.scars.panelScorch) {
    progress.scars.panelScorch = true;
    void persist();
  }
  if (success && !final) prepareCurrent(); // sıradaki aşama

  const repair = () => {
    // Yedek parça: yeni deneme yeni sayılarla; kalıcı hasar onarılana kadar sürer.
    attempt++;
    prepareCurrent();
    hub.repairForRetry();
    showStageProgress();
    failurePulse = false;
    updateMood(CALM_DOWN_SECONDS);
  };

  showIncidentReport(ui, result, {
    onSound: uiSound,
    onNext: success && !final && !critical ? openPuzzle : undefined,
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
