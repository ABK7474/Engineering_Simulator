// Bağlama: dünya ↔ hub ↔ bulmaca ↔ çözücü ↔ olay raporu ↔ ses ↔ kaynaklar ↔ ilerleme ↔ harita ↔ replikler.
// Hub ve 2D paneller kaynakları ve dünya durumunu bilmez; kararlar burada core/ ve world/ ile verilir.

import './style.css';
import balanceJson from '../content/balance/resources.json';
import coursesJson from '../content/courses.json';
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
  supersede,
  templatePool,
  upsertTopic,
  validateLibrary,
  withRepoTopics,
  type ApproveEdits,
  type Library,
  type Topic,
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
  spend,
  tensionFor,
  tick,
  type Amounts,
  type ResourceEvent,
} from './core/resources';
import { createRng } from './core/rng';
import { initialThreat, tickThreat, type ThreatDef, type ThreatEvent } from './core/threat';
import { dueLabel, dueTopics, recordReview, topicKey } from './core/review';
import { formulaPages, parseLogs, unlockedLogs } from './core/notebook';
import logsJson from '../content/story/logs.json';
import objectivesJson from '../content/story/objectives.json';
import { objectiveLine, objectiveView, parseObjectives } from './story/objectives';
import { cleanName, resolveLines, type Line } from './story/lines';
import topicsJson from '../content/topics.json';
import { openNotebook } from './ui/notebook';
import { showFinale, showSeasonEnd } from './ui/finale';
import { clearApiKey, getApiKey, getModel, maskKey, setApiKey, setModel } from './core/secrets';
import type { StageDef } from './core/types';
import { createHub } from './hub/hub';
import { showIncidentReport } from './puzzles/incident-report/report';
import { prepareStage, validateStage, type StageRun } from './puzzles/stages';
import { getProvider, LLM_DEFAULTS, type LlmSettings } from './llm/llm';
import { createTopicDraft, generateTopicTemplates, type Course } from './pipeline/topic-pipeline';
import { mountBackupMenu } from './ui/backup';
import { showEpisodeClosed } from './ui/episode-closed';
import { mountMap, type MapView } from './ui/map';
import { mountSubtitles } from './ui/subtitle';
import { loadEnding, loadPrologue, loadWorld } from './world/content';
import { createPrologueFlow, type PrologueFlow } from './prologue-flow';
import { createEndingFlow } from './ending-flow';
import { loadMeta, saveMeta } from './core/meta';
import type { ResourceState } from './core/resources';
import { respawnInRoom } from './world/respawn';
import { doorOpen, missingFor, nextGoal, testUnlockStates, withProvided } from './world/state';
import { digitOf, keySequence } from './ui/key-sequence';
import { mountHud, type HudView } from './ui/hud';
import { openLibraryView } from './ui/library-view';
import { openSettings } from './ui/settings';
import { askApiKey, openTopicFlow, type TopicFlowDeps } from './ui/topic-flow';
import { createMaterialsFlow } from './materials-flow';
import { repoTopics } from './pipeline/materials';

// --- Dünya içeriği (JSON): doğrulanır; bozuksa açıklamalı hata verir ---
const content = loadWorld(undefined, undefined, undefined, { verifySeeds: 1 }); // 20 tohumluk tam doğrulama testlerde
const W = content.world;
const L = content.layout;
const FAULTS = new Map(W.faults.map((f) => [f.id, f]));
const stagesOf = (fid: string) => content.stages[fid];
Object.values(content.stages).flat().forEach(validateStage);
const MIGRATION = {
  startRoom: W.start.room,
  faults: W.faults.map((f) => ({ id: f.id, card: f.card, provides: f.provides, stageCount: stagesOf(f.id).length })),
};
const balance = parseBalance(balanceJson);
const OBJECTIVES = parseObjectives(objectivesJson);
/** Bir durumu sağlayan arızanın kart adı (hedef satırı için). */
const stateName = (state: string) => {
  const f = W.faults.find((x) => x.provides.includes(state));
  return f ? content.cards[f.card].title : null;
};
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
let progress = await loadProgress(store, balance, MIGRATION);
/** Oynayışlar arası (sıfırlamada kalır): prolog görüldü mü. */
const meta = await loadMeta(kv);
if (!W.rooms.some((r) => r.id === progress.world.room)) progress.world.room = W.start.room;
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
/** Prologda HUD Müren'in kaynaklarını gösterir. */
let hudResources: ResourceState | null = null;
/** Bilek cihazı (hub kurulunca bağlanır); klasik HUD kapalıyken bilgiler yalnız bilekte. */
let wristSink: ((v: HudView) => void) | null = null;
const CLASSIC_KEY = 'derin-muhendis.ui.classicHud';
const classicHud = () => {
  try {
    return localStorage.getItem(CLASSIC_KEY) === '1';
  } catch {
    return false;
  }
};
const applyHudMode = () => document.body.classList.toggle('wrist-hud', !classicHud());
applyHudMode();
const renderHud = () => {
  const res = hudResources ?? progress.resources;
  const drain = drainPerMinute(res, balance);
  const view: HudView = {
    rows: Object.entries(balance.resources).map(([id, def]) => ({
      id,
      label: def.label,
      value: res.values[id],
      max: def.max,
      level: level(balance, res.values[id]),
      drainPerMinute: drain[id],
    })),
    damages: hudResources ? [] : [...new Set(progress.resources.damages.map((d) => d.label))],
    episode: progress.episode,
    threat: activeThreatView(),
    reviewDue: dueTopics(progress.review, Date.now()).length,
    goal: progress.prologueDone ? objectiveLine(OBJECTIVES, progress.world.states, stateName) : undefined,
  };
  hud.render(view);
  wristSink?.(view);
  // Bilek cihazı uyarısı: kaynak düşükken ya da temas başlayınca bir kez bip (durum düzelince yeniden kurulur)
  const alert = view.rows.some((r) => r.level !== 'ok') || Boolean(view.threat);
  if (alert && !wristAlerted) audio.synth.beep(); // ses başlamadıysa (giriş ekranı) sessizce yok sayılır
  wristAlerted = alert;
};
let wristAlerted = false;
setInterval(() => renderHud(), 30_000);
/** HUD için süren tehdit (varsa): saldırıya kalan süre, oyuncunun gürültüsü. */
let threatNoise: 0 | 1 | 2 = 0;
function activeThreatView(): { remaining: number; noise: 0 | 1 | 2 } | null {
  for (const t of W.threats) {
    const st = progress.threats[t.id];
    if (st?.phase === 'active') return { remaining: Math.max(0, st.timer), noise: threatNoise };
  }
  return null;
}
renderHud();
// --- Konu kütüphanesi ve içerik hattı (LLM yalnız burada; oyun sırasında çağrılmaz) ---
const COURSES = coursesJson as Course[];
/** Konu şablonlarının temel aldığı yapılandırmalar: her türün içerikteki ilk aşaması. */
const BASES = Object.fromEntries(
  [...Object.values(content.stages).flat()].reverse().map((s) => [s.type, s]),
) as Record<StageDef['type'], StageDef>;
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
// Repodaki onaylı konular (content/library/) da kütüphaneye girer; bu tarayıcıdaki sürüm öncelikli.
let library = sanitize(withRepoTopics(await loadLibrary(kv), repoTopics()));
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
const keyDeps = { providerLabel, keyAdvice: LLM_DEFAULTS.keyAdvice, saveKey: setApiKey };
// --- ders_materyalleri/ (yalnız dev sunucusu): klasördeki notlar ve sorular kendiliğinden işlenir ---
const materialsStatus = document.createElement('div');
materialsStatus.className = 'materials-status';
materialsStatus.hidden = true;
ui.appendChild(materialsStatus);
const materials = await createMaterialsFlow({
  kv,
  courses: coursesJson as Course[],
  getLibrary: () => library,
  setLibrary: async (lib) => {
    library = sanitize(lib);
    await persistLibrary();
  },
  llm: llmSettings,
  needsKey: () => !getApiKey(),
  askKey: () => new Promise((done) => withHubPaused((onClose) => void askApiKey(ui, keyDeps).then((ok) => (onClose(), done(ok))))),
  canPrompt: () => started && hub.isRoaming() && !prologueActive() && !ui.querySelector('.overlay'),
  saveModel: setModel,
  onStatus: (text) => {
    materialsStatus.hidden = !text;
    materialsStatus.textContent = text ?? '';
  },
});
/** Onay (Konu ekle ya da klasör taslağı): aynı dosyanın eski sürümü çıkar; klasör konusu repoya yazılır. */
const approveAndStore = async (t: Topic, edits: ApproveEdits) => {
  const approved = approveTopic(t, edits);
  library = supersede(library, approved);
  await persistLibrary();
  await materials.afterApprove(approved);
  return approved;
};
const generateAndStore = async (t: Topic) => {
  const existing = library.topics.flatMap((x) => x.templates.map((y) => y.stage));
  const done = await generateTopicTemplates(llmSettings(), t, { course: COURSES.find((c) => c.id === t.courseId)!, bases: BASES, existing });
  library = upsertTopic(library, done);
  await persistLibrary();
  await materials.afterApprove(done);
  return done;
};
function openLibrary(tab?: 'topics' | 'folder' | 'analysis'): void {
  withHubPaused((onClose) =>
    openLibraryView(ui, {
      lib: () => library,
      remove: async (id) => {
        library = removeTopic(library, id);
        await persistLibrary();
      },
      review: (id, done) => {
        const draft = library.topics.find((t) => t.id === id);
        if (!draft) return;
        void materials.pdfFor(draft).then((pdf) => openTopicFlow(ui, topicFlowDeps(done), { draft, pdf }));
      },
      analyses: materials.analyses,
      folder: materials.folder,
      tab,
      onClose,
    }),
  );
}
const topicFlowDeps = (onClose: () => void): TopicFlowDeps => ({
  courses: COURSES,
  ...keyDeps,
  // Sahte istemci anahtarı kullanmaz ama akış (ve sızıntı denetimi) gerçeğiyle aynı kalsın.
  needsKey: () => !getApiKey(),
  createDraft: (input) => createTopicDraft(llmSettings(), input),
  approve: approveAndStore,
  generate: generateAndStore,
  onClose,
});
/** Menüden açılan ekranlar: koridordaki girdiyi askıya alır, kapanınca geri verir. */
const withHubPaused = (open: (onClose: () => void) => void) => {
  hub.suspend();
  map.toggle(false);
  open(() => {
    runs.clear(); // yeni ya da silinen şablonlar sıradaki aşamalara yansısın
    hub.resume();
  });
};

mountBackupMenu(ui, {
  items: [
    {
      label: 'Konu ekle…',
      onClick: () => withHubPaused((onClose) => openTopicFlow(ui, topicFlowDeps(onClose))),
    },
    {
      label: 'Konu kütüphanesi',
      onClick: () => openLibrary(),
    },
    {
      label: 'Defter (N)…',
      onClick: () => toggleNotebook(),
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
            classicHud,
            saveClassicHud: (on: boolean) => {
              try {
                localStorage.setItem(CLASSIC_KEY, on ? '1' : '0');
              } catch {
                /* depolama kapalıysa yalnız bu oturum */
              }
              applyHudMode();
              if (!on) map.toggle(false);
            },
            playerName: () => progress.profile.name,
            savePlayerName: (n) => {
              progress.profile.name = cleanName(n);
              void persist();
            },
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
    const imported = fromExportJson(text, balance, MIGRATION);
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
    progress = defaultProgress(balance, W.start.room);
    await persist();
    location.reload();
  },
});

const spawnRoom = W.rooms.find((r) => r.id === progress.world.room)!;
// Prolog akışı hub kurulduktan sonra bağlanır; hub'ın ilk kareleri bunlara erişebilir.
let prologue: PrologueFlow | null = null;
const prologueActive = () => prologue?.active === true;
// ?prologue=skip: betikler (e2e, ekran görüntüleri) prologu atlar
let skipPrologue = new URLSearchParams(location.search).get('prologue') === 'skip';
const hub = await createHub(app, {
  assetBase: ASSETS,
  sounds: audio,
  layout: L,
  spawn: spawnRoom.entrance,
  onInteract: interact,
  hintFor,
  onRoomChange,
  onStart: () => {
    void audioReady.then(() => audio.start());
    if (started) return;
    started = true;
    // Giriş ekranındaki ad alanı odakta kalırsa boşluk/E tuşları ona gider
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    hub.gateBox.querySelector('.gate-extra')?.remove();
    if (prologue && !progress.prologueDone) {
      if (skipPrologue) prologue.skip();
      else prologue.start();
      return;
    }
    // Replikler oyuncu başlayınca: önce açılış, sonra bulunulan odanın girişi (giriş ekranının arkasında kalmasın).
    say('start');
    say(`enter:${progress.world.room}`);
  },
  onPrologueTarget: (t) => prologue?.debug.interact(t),
});

// Bilek cihazı: HUD'un gösterdiği her şey bilekte de
wristSink = (v) => hub.arms.setInfo({ rows: v.rows, goal: v.goal, threat: v.threat, reviewDue: v.reviewDue, damages: v.damages });
renderHud();

// --- Ortam: ana bara beslenince sonar yayında, düzenli ping (uzak, kısık) ---
setInterval(() => {
  if (started && progress.world.states.includes('power.main')) audio.play('sonar', { volume: 0.32, pitchJitter: 0.02 });
}, 21_000);

// --- Replikler ve harita ---
const subtitles = mountSubtitles(ui);

// --- Final: kapsülle yükseliş (yalnız "Kapsülle ayrıl" seçilince; sonra sezon özeti, serbest dolaşma) ---
const ending = createEndingFlow({
  stage: hub.ending,
  def: loadEnding(),
  ui,
  subtitles,
  spoken: (lines) => spoken(lines),
  audio,
  onDone: () => showSeasonEnd(ui, { stats: seasonStats(), onContinue: () => hub.resume() }),
});

// --- Prolog: Müren, iniş, iki kolay bulmaca, düşüş, deniz tabanı, servis kilidi ---
const PROLOGUE = loadPrologue(undefined, undefined, undefined, { verifySeeds: 1 });
prologue = hub.prologue
  ? createPrologueFlow({
      hub,
      stage: hub.prologue,
      def: PROLOGUE.def,
      stages: PROLOGUE.stages,
      ui,
      subtitles,
      spoken: (lines) => spoken(lines),
      audio,
      balance,
      seed: baseSeed,
      uiSound,
      attachHints: (h) => attachHints(h, false),
      showResources: (r) => {
        hudResources = r;
        renderHud();
      },
      onDone: (skipped) => {
        progress.prologueDone = true;
        if (!progress.world.states.includes('prologue.done')) progress.world.states.push('prologue.done');
        progress.world.room = W.start.room;
        if (skipped) {
          const e = spawnRoom.entrance;
          hub.teleport(e.x, e.z, e.yaw);
        }
        meta.prologueSeen = true;
        void saveMeta(kv, meta);
        void persist();
        renderHud();
        say('start');
        say(`enter:${progress.world.room}`);
      },
    })
  : null;
if (prologue && !progress.prologueDone) {
  prologue.prepare();
  // Giriş ekranı: ad ve (prolog daha önce görüldüyse) atlama
  const box = document.createElement('div');
  box.className = 'gate-extra';
  box.innerHTML = `<label class="gate-name">Adın <input name="pname" maxlength="20" spellcheck="false" autocomplete="off"></label>
    ${meta.prologueSeen ? '<button class="ghost small gate-skip" data-act="skip">Prologu atla ve başla</button>' : ''}`;
  const nameIn = box.querySelector<HTMLInputElement>('input')!;
  nameIn.value = progress.profile.name;
  nameIn.addEventListener('click', (e) => e.stopPropagation());
  nameIn.addEventListener('keydown', (e) => e.stopPropagation());
  nameIn.addEventListener('change', () => {
    progress.profile.name = cleanName(nameIn.value);
    void persist();
  });
  box.querySelector('[data-act="skip"]')?.addEventListener('click', () => {
    skipPrologue = true;
  });
  hub.gateBox.querySelector('.gate-action')!.before(box);
}
/** Replikleri oyuncunun adıyla çözer. */
const spoken = (lines: readonly Line[] | undefined) => resolveLines(content.story, lines, progress.profile.name);
/** Oyuncu "Tıkla ve başla"ya bastı mı (öncesinde söylenen replik görünmezdi). */
let started = false;
/** Yapay zekâ repliği; `once` ise oturumlar boyunca bir kez (seenLines). */
function say(key: string, once = true): void {
  const lines = content.story.lines[key];
  if (!lines) return;
  if (once) {
    if (progress.world.seenLines.includes(key)) return;
    progress.world.seenLines.push(key);
    void persist();
  } else if (subtitles.busy()) return;
  subtitles.say(spoken(lines));
}
const map = mountMap(ui);
let mapTarget: string | null = null;
/** Harita: klasik HUD'da köşe paneli, değilse bilek cihazında (kol kalkar). */
function openMap(open?: boolean): void {
  if (classicHud()) {
    map.toggle(open);
    renderMap();
    return;
  }
  const want = open ?? hub.arms.mode !== 'map';
  void hub.arms.raise(want ? 'map' : 'rest');
  renderMap();
}
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
window.addEventListener('keydown', (e) => {
  // Panel/rapor/defter açıkken M haritayı arkada açmasın
  if (e.code !== 'KeyM' || typing(e) || prologueActive() || ui.querySelector('.overlay')) return;
  openMap();
});
// Q: bilek cihazına bak (kolu kaldır / indir)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyQ' || typing(e) || e.repeat || !hub.isRoaming()) return;
  void hub.arms.raise(hub.arms.mode === 'glance' ? 'rest' : 'glance');
});

// --- Arızalar: ardışık aşamalar, koşullar (requires) ve sağladıkları durumlar (provides) ---
const states = () => progress.world.states;
const stagesDone = (fid: string) => progress.faults[fid]?.stagesDone ?? 0;
const isSolved = (fid: string) => stagesDone(fid) >= stagesOf(fid).length;
const solvedSet = () => new Set(W.faults.filter((f) => isSolved(f.id)).map((f) => f.id));
const stageIndex = (fid: string) => Math.min(stagesDone(fid), stagesOf(fid).length - 1);
const progressText = (fid: string, done: number) => `AŞAMA ${done}/${stagesOf(fid).length}\nTAMAM`;
const fidSalt = (fid: string) => [...fid].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);
/** Aşama problemi: tohum taban + deneme + aşama + arıza; ?seed ile tekrarlanabilir. */
const stageSeed = (fid: string) => baseSeed + attempt + 1000 * stageIndex(fid) + fidSalt(fid);
/** Bu arızanın açtığı kapı (motor sonuçları kapıyı oynatır). */
const doorFor = (fid: string) => W.doors.find((d) => d.opensWhen.some((s) => FAULTS.get(fid)!.provides.includes(s)))?.id;

/**
 * Aşamanın tanımı: arıza konu şablonlarına izin veriyorsa ve kullanıcının onaylı konularından o türde
 * şablon varsa onlardan biri (kendi notundan çalışsın diye öncelikli); yoksa içerikteki (oda zorluklu) aşama.
 */
function pickStageDef(fid: string): StageDef {
  const base = stagesOf(fid)[stageIndex(fid)];
  if (!FAULTS.get(fid)!.allowTopicTemplates) return base;
  const pool = templatePool(library, base.type);
  return pool.length ? pool[stageSeed(fid) % pool.length] : base;
}
const runs = new Map<string, { def: StageDef; run: StageRun; index: number }>();
function getRun(fid: string) {
  const cur = runs.get(fid);
  if (cur && cur.index === stageIndex(fid)) return cur;
  const def = pickStageDef(fid);
  const r = { def, run: prepareStage(def, stageSeed(fid)), index: stageIndex(fid) };
  runs.set(fid, r);
  return r;
}

/** Olay panosu yalnız kendi tehdidi sürerken çalışır. */
const eventBlocked = (fid: string) => {
  const ev = FAULTS.get(fid)!.event;
  return ev !== undefined && progress.threats[ev]?.phase !== 'active';
};
const blockedNow = (fid: string) => missingFor(FAULTS.get(fid)!, states()).length > 0 || eventBlocked(fid);

/** Terminal ekranı arızanın durumuna göre. */
function refreshTerminal(fid: string): void {
  const f = FAULTS.get(fid)!;
  if (isSolved(fid)) hub.showSolved(fid, f.screen?.solved ?? 'ONARILDI');
  else if (blockedNow(fid)) hub.setScreen(fid, f.screen?.blocked ?? 'KOŞUL\nEKSİK', '#8aa0a4');
  else if (stagesDone(fid) > 0) hub.showProgress(fid, progressText(fid, stagesDone(fid)));
  else hub.setScreen(fid, f.screen?.fault ?? 'ARIZA', '#ff5040', true);
}
const refreshAll = () => W.faults.forEach((f) => refreshTerminal(f.id));

function hintFor(fid: string): string | null {
  const f = FAULTS.get(fid);
  if (!f || isSolved(fid)) return null;
  return blockedNow(fid) ? (f.blockedHint ?? 'E: Koşul eksik — haritaya bak') : 'E: Paneli aç';
}

function onRoomChange(roomId: string): void {
  if (prologueActive()) return; // kilitten içeri alınırken; replikler prolog bitince
  progress.world.room = roomId;
  if (!progress.world.discovered.includes(roomId)) progress.world.discovered.push(roomId);
  if (started) say(`enter:${roomId}`);
  void persist();
  renderMap();
}

function buildMapView(): MapView {
  const disc = progress.world.discovered;
  return {
    title: 'Kat planı',
    rooms: L.rooms.map(({ def, rect }) => ({ id: def.id, name: def.name, rect, discovered: disc.includes(def.id), current: def.id === progress.world.room })),
    doors: L.doors.map((d) => ({ id: d.def.id, x: d.x, z: d.z, horizontal: d.rotY === 0, open: doorOpen(d.def, states()), visible: d.def.rooms.some((r) => disc.includes(r)) })),
    faults: W.faults.map((f) => ({
      id: f.id,
      label: content.cards[f.card].title,
      why: OBJECTIVES.why[f.id],
      ...hub.terminalPosition(f.id),
      status: isSolved(f.id) ? 'solved' : blockedNow(f.id) ? 'blocked' : 'open',
      visible: disc.includes(f.room) || f.id === mapTarget,
    })),
    player: hub.pose(),
    target: mapTarget,
    bounds: L.bounds,
  };
}
function renderMap(): void {
  if (map.isOpen()) map.render(buildMapView());
  if (hub.arms.mode === 'map') {
    const v = buildMapView();
    hub.arms.setMap({
      bounds: v.bounds,
      rooms: v.rooms.filter((r) => r.discovered).map((r) => ({ name: r.name, rect: r.rect, current: r.current })),
      doors: v.doors.filter((d) => d.visible).map((d) => ({ x: d.x, z: d.z, horizontal: d.horizontal, open: d.open })),
      faults: v.faults.filter((f) => f.visible).map((f) => ({ x: f.x, z: f.z, status: f.status, target: f.id === v.target })),
      player: v.player,
      targetLabel: v.faults.find((f) => f.id === v.target)?.label,
    });
  }
}
setInterval(renderMap, 200);

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

// --- Kritik kaynak: oyun bitmez, bulunulan odanın girişinden devam edilir ---
let closing = false;
function closeEpisode(): void {
  if (closing) return;
  closing = true;
  hub.suspend();
  const roomId = progress.world.room;
  const room = W.rooms.find((r) => r.id === roomId)!;
  const [id, value] = Object.entries(progress.resources.values).sort((a, b) => a[1] - b[1])[0];
  showEpisodeClosed(ui, {
    title: 'Acil durum protokolü',
    reason: `${balance.resources[id].label} %${Math.floor(value)} — kritik seviye`,
    body: `${room.name} girişine dönüyorsun. Çözdüğün arızalar çözülmüş kalır; bu odadaki yarım onarımlar baştan başlar.`,
    button: 'Girişten devam et',
    episode: progress.episode,
    attempts: progress.attemptsThisEpisode,
    worst: progress.worstEvent?.label ?? null,
    onRestart: () => {
      progress = respawnInRoom(progress, balance, W, roomId, (fid) => stagesOf(fid).length);
      attempt++;
      const roomFaults = W.faults.filter((f) => f.room === roomId).map((f) => f.id);
      roomFaults.forEach((fid) => runs.delete(fid));
      failurePulse = false;
      hub.resetTerminals(roomFaults);
      refreshAll();
      hub.teleport(room.entrance.x, room.entrance.z, room.entrance.yaw);
      renderHud();
      updateMood(3);
      say('respawn', false);
      void persist();
      closing = false;
      hub.resume();
    },
  });
}

// Tüketimden gelen olaylar (hata anındaki olaylar için siren zaten hub'da çalar).
function onDrainEvents(events: ResourceEvent[]): void {
  if (events.some((e) => e.type === 'crossedWarning' || e.type === 'critical')) audio.alarm(ALARM_SECONDS);
  if (events.some((e) => e.type === 'critical')) {
    void persist();
    closeEpisode();
  }
}

// --- Kayıttan geri yükleme ---
for (const d of W.doors) hub.setDoorOpen(d.id, doorOpen(d, states()));
refreshAll();
hub.restoreScars(progress.world.scorched);
updateMood(0.1);
if (isCritical(progress.resources, balance)) closeEpisode();

// --- Tehdit olayı: koşullar sağlanınca başlar; sayaç yalnız dolaşırken, gürültüyle hızlanır ---
function onThreatEvent(def: ThreatDef, e: ThreatEvent): void {
  const board = W.faults.find((f) => f.event === def.id);
  if (e.kind === 'started') {
    if (!states().includes(def.activeState)) progress.world.states = [...states(), def.activeState];
    hub.setThreat(true);
    audio.alarm(ALARM_SECONDS);
    if (board) mapTarget = board.id;
    refreshAll();
    say(`threat:${def.id}:start`, false);
    void persist();
  } else if (e.kind === 'warning') {
    audio.play('sonar', { volume: 0.6 });
    say(`threat:${def.id}:warning`, false);
  } else if (e.kind === 'strike') {
    const outcome = {
      kind: 'creature_strike' as const,
      severity: 1,
      resistorOverheat: false,
      headline: 'Yaratık istasyona saldırdı',
      explanation: 'Karartma yapılmadan temas istasyona ulaştı.',
    };
    const step = applyOutcome(progress.resources, balance, `${def.id}#${e.strikes}`, outcome);
    progress.resources = step.state;
    const damage = step.events.find((x) => x.type === 'damage');
    if (damage && damage.type === 'damage') {
      const sum = Object.values(damage.loss).reduce((a, b) => a + b, 0);
      if (!progress.worstEvent || sum > progress.worstEvent.total) progress.worstEvent = { label: damage.label, total: sum };
    }
    hub.threatStrike();
    audio.alarm(ALARM_SECONDS);
    say(`threat:${def.id}:strike`, false);
    renderHud();
    updateMood(2);
    void persist();
    if (isCritical(progress.resources, balance)) closeEpisode();
  } else if (e.kind === 'cleared') {
    progress.world.states = states().filter((x) => x !== def.activeState);
    hub.setThreat(false);
    hub.creaturePass();
    if (board && mapTarget === board.id) mapTarget = null;
    say(`threat:${def.id}:cleared`, false);
    refreshAll();
    void persist();
  }
}
for (const t of W.threats) if (progress.threats[t.id]?.phase === 'active') hub.setThreat(true);
let lastThreatTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(1, (now - lastThreatTick) / 1000);
  lastThreatTick = now;
  if (closing || !started) return;
  threatNoise = hub.noiseLevel();
  for (const def of W.threats) {
    const r = tickThreat(def, progress.threats[def.id] ?? initialThreat(), { states: states(), dt, roaming: hub.isRoaming(), noise: threatNoise });
    progress.threats[def.id] = r.state;
    for (const e of r.events) onThreatEvent(def, e);
    if (r.state.phase === 'active') renderHud();
  }
}, 250);
// Tehdit sürerken sonar sık ve yüksek pinger
setInterval(() => {
  if (started && activeThreatView()) audio.play('sonar', { volume: 0.5, pitchJitter: 0.02 });
}, 6_000);

// --- Kalıcı hasar tüketimi: oyun saatiyle, yalnız dolaşırken ---
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(1, (now - lastTick) / 1000);
  lastTick = now;
  if (closing || !hub.isRoaming() || prologueActive()) return;
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
      /** Final sahnesi: hangi sahnede, sahneye atla, geç. */
      ending: { active: () => ending.active, beat: () => ending.debug.beat(), skipTo: (id: string) => ending.debug.skipTo(id), skip: () => ending.skip() },
      progress: () => structuredClone(progress),
      stage: (fid: string) => ({ fid, index: stageIndex(fid), baseSeed, attempt, seed: stageSeed(fid), def: structuredClone(getRun(fid).def) }),
      library: () => structuredClone(library),
      map: () => buildMapView(),
      /** Test kısayolu: durumları sağlanmış say (ör. yedek güç), terminalleri yenile. */
      grant: (granted: string[]) => {
        progress.world.states = [...new Set([...states(), ...granted])];
        refreshAll();
      },
      /** E2E: açık aşamanın kodla hesaplanmış doğru cevabı. */
      solution: (fid: string) => structuredClone(getRun(fid).run.solution),
      /** E2E: açık paneli kapatıp cevabı panelin göndereceği yoldan değerlendirir (olay raporu açılır). */
      submit: (fid: string, answer: unknown) => {
        ui.querySelectorAll('.overlay').forEach((o) => o.remove());
        void runAttempt(fid, answer);
      },
      /** Test kısayolu: bütün arızaları onarılmış say ve finali göster. */
      solveAll: () => {
        for (const f of W.faults) progress.faults[f.id] = { stagesDone: stagesOf(f.id).length };
        progress.world.states = [...new Set([...states(), ...W.faults.flatMap((f) => f.provides)])];
        refreshAll();
        return maybeFinale();
      },
      /** Test kısayolu: tehdit olayını hemen başlat ya da süresini ayarla. */
      threat: (id: string, timer?: number) => {
        const st = progress.threats[id] ?? initialThreat();
        if (timer !== undefined) progress.threats[id] = { ...st, phase: st.phase === 'cleared' ? 'cleared' : 'pending', timer };
        return structuredClone(progress.threats[id] ?? st);
      },
      /** Klasik HUD aç/kapa (Ayarlar'daki kutuyla aynı yol). */
      setClassicHud: (on: boolean) => {
        try {
          localStorage.setItem(CLASSIC_KEY, on ? '1' : '0');
        } catch {
          /* yok say */
        }
        applyHudMode();
        if (!on) map.toggle(false);
      },
      /** Prolog: sahne, atlama, açık bulmacayı kodun cevabıyla çözme, hedefe dokunma. */
      prologue: prologue && {
        beat: () => prologue.debug.beat(),
        skipTo: (id: string) => prologue.debug.skipTo(id),
        solve: () => prologue.debug.solve(),
        interact: (t: string) => prologue.debug.interact(t),
        skip: () => prologue.skip(),
        active: () => prologue.active,
      },
      /** ders_materyalleri/ kuyruğu: durum, sahte istemci çağrıları, listeyi yenile; kütüphaneyi sekmesiyle aç. */
      materials: { ...materials.debug, analyses: () => materials.analyses(), openLibrary },
      setResources: (values: Amounts) => {
        progress.resources = { ...progress.resources, values: { ...progress.resources.values, ...values } };
        renderHud();
        updateMood();
      },
    },
  });
}

/** E ile terminal: koşul eksikse "güç yok" + harita hedefi; değilse bulmaca paneli. */
function interact(fid: string): void {
  const f = FAULTS.get(fid)!;
  if (isSolved(fid)) return;
  if (eventBlocked(fid) && !missingFor(f, states()).length) {
    // Olay panosu: tehdit başlamadan açılmaz
    uiSound('switch');
    refreshTerminal(fid);
    return;
  }
  const missing = missingFor(f, states());
  if (missing.length) {
    mapTarget = nextGoal(W, states(), solvedSet(), f)?.id ?? null;
    openMap(true);
    refreshTerminal(fid);
    uiSound('switch');
    say(`blocked:${missing[0]}`, false);
    return;
  }
  openPuzzle(fid);
}

// --- İpuçları: panelin başlığına düğme; her ipucu kaynak harcatır (pratikte ücretsiz) ---
const STATION_LOGS = parseLogs(logsJson);
const TOPIC_NAMES = topicsJson as Record<string, string>;
const COURSE_NAMES = Object.fromEntries(COURSES.map((c) => [c.id, c.name]));
function attachHints(hints: string[], paid: boolean): void {
  const overlays = ui.querySelectorAll<HTMLElement>('.overlay');
  const panel = overlays[overlays.length - 1]?.querySelector<HTMLElement>('.panel');
  const head = panel?.querySelector('.panel-head');
  if (!panel || !head || !hints.length) return;
  const cost = fmtAmounts(balance.hintCost, '−');
  const btn = document.createElement('button');
  btn.className = 'ghost small hint-btn';
  const box = document.createElement('div');
  box.className = 'hint-box';
  box.hidden = true;
  let shown = 0;
  const label = () => (btn.textContent = shown < hints.length ? `İpucu ${shown + 1}/${hints.length}${paid ? ` (${cost})` : ''}` : 'İpucu kalmadı');
  label();
  btn.addEventListener('click', () => {
    if (shown >= hints.length) return;
    if (paid) {
      const step = spend(progress.resources, balance, balance.hintCost);
      progress.resources = step.state;
      renderHud();
      updateMood();
      void persist();
      onDrainEvents(step.events);
    }
    const p = document.createElement('p');
    p.textContent = hints[shown++];
    box.append(p);
    box.hidden = false;
    btn.disabled = shown >= hints.length;
    label();
    uiSound('click');
  });
  head.insertBefore(btn, head.querySelector('[data-act="cancel"]'));
  (panel.querySelector('.briefing') ?? head).after(box);
}

/** Bulmaca panelinde onarımın hedefe bağlantısı ("Neden"). */
function attachWhy(why: string | undefined): void {
  const overlays = ui.querySelectorAll<HTMLElement>('.overlay');
  const panel = overlays[overlays.length - 1]?.querySelector<HTMLElement>('.panel');
  const head = panel?.querySelector('.panel-head');
  if (!panel || !head || !why) return;
  const p = document.createElement('p');
  p.className = 'why';
  p.textContent = `Neden: ${why}`;
  head.after(p);
}

// --- Defter (N): tekrar, formüller, istasyon kayıtları ---
const allStages = () => Object.values(content.stages).flat();
function notebookView() {
  const now = Date.now();
  const due = new Set(dueTopics(progress.review, now));
  const st = states();
  return {
    goals: {
      title: OBJECTIVES.title,
      objectives: objectiveView(OBJECTIVES, st).map((o) => {
        const def = OBJECTIVES.objectives.find((x) => x.id === o.id)!;
        return {
          title: o.title,
          summary: o.summary,
          done: o.done,
          steps: def.steps.map((s) => {
            const f = W.faults.find((x) => x.provides.includes(s));
            return { label: stateName(s) ?? s, why: (f && OBJECTIVES.why[f.id]) ?? '', done: st.includes(s) };
          }),
        };
      }),
    },
    review: Object.entries(progress.review)
      .sort((a, b) => a[1].due - b[1].due)
      .map(([key, it]) => {
        const [course, topic] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
        return {
          key,
          courseName: COURSE_NAMES[course] ?? course,
          topicName: TOPIC_NAMES[topic] ?? allStages().find((s) => s.topic === topic)?.title ?? topic,
          box: it.box,
          dueLabel: dueLabel(it.due, now),
          due: due.has(key),
          practicable: allStages().some((s) => topicKey(s.course, s.topic) === key),
        };
      }),
    formulas: formulaPages(Object.values(content.cards), progress.review, COURSE_NAMES, TOPIC_NAMES),
    // Onaylı konuların formül sayfaları (Konu ekle ve ders_materyalleri/)
    topicPages: library.topics
      .filter((t) => t.status === 'approved' && t.formulaSheet.trim())
      .sort((a, b) => a.courseName.localeCompare(b.courseName, 'tr') || a.name.localeCompare(b.name, 'tr'))
      .map((t) => ({ courseName: t.courseName, name: t.name, sheet: t.formulaSheet })),
    logs: unlockedLogs(STATION_LOGS, states()),
    totalLogs: STATION_LOGS.length,
  };
}
let notebookOpen = false;
function toggleNotebook(): void {
  if (notebookOpen || closing || !started || prologueActive()) return;
  notebookOpen = true;
  // Kol kaldırılır (bilek cihazı), sonra defter normal panel olarak açılır; kapanınca kol iner
  if (!classicHud()) void hub.arms.raise('notebook').then(openNotebookPanel);
  else openNotebookPanel();
}
function openNotebookPanel(): void {
  withHubPaused((onClose) =>
    openNotebook(ui, notebookView(), {
      onPractice: (key) => {
        notebookOpen = false;
        void hub.arms.raise('rest');
        onClose();
        openPractice(key);
      },
      onClose: () => {
        notebookOpen = false;
        void hub.arms.raise('rest');
        onClose();
      },
    }),
  );
}
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyN' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (!hub.isRoaming() && !notebookOpen) return; // panel açıkken N defteri açmaz
  toggleNotebook();
});

// Test kodları (oyunda sırayla, rakam tuşlarıyla). 681: prolog atlanır, bütün kapılar ve terminaller açılır, odalar
// haritada görünür, kaynaklar dolar; arızalar çözülmüş sayılmaz (bulmacalar denenebilir). 923: ayrıca bütün
// arızalar onarılmış sayılır ve final gelir. Kayda yazılır, Ayarlar'dan sıfırlanır.
function testUnlock(solveAll: boolean): void {
  if (prologueActive()) prologue!.skip();
  const before = new Set(W.doors.filter((x) => doorOpen(x, states())).map((x) => x.id));
  progress.world.states = testUnlockStates(W, states());
  if (solveAll) {
    for (const f of W.faults) progress.faults[f.id] = { stagesDone: stagesOf(f.id).length };
    progress.world.states = [...new Set([...states(), ...W.faults.flatMap((f) => f.provides)])];
    mapTarget = null;
  }
  progress.world.discovered = W.rooms.map((r) => r.id);
  progress.resources = {
    ...progress.resources,
    values: Object.fromEntries(Object.entries(balance.resources).map(([id, def]) => [id, def.max])),
  };
  for (const x of W.doors) if (!before.has(x.id) && doorOpen(x, states())) hub.setDoorOpen(x.id, true, true);
  refreshAll();
  renderHud();
  updateMood();
  renderMap();
  void persist();
  uiSound('switch');
  const text = solveAll ? 'Test kodu: bütün arızalar onarıldı.' : 'Test kodu: bütün kapılar ve terminaller açık, kaynaklar dolu.';
  subtitles.say([{ who: 'suit', label: 'TEST', text }]);
  if (solveAll) {
    // 923 finali her seferinde yeniden gösterir
    progress.world.seenLines = progress.world.seenLines.filter((k) => k !== 'finale');
    maybeFinale();
  }
}
const testCodes = [
  { hit: keySequence('681'), solveAll: false },
  { hit: keySequence('923'), solveAll: true },
];
window.addEventListener('keydown', (e) => {
  const d = digitOf(e.code);
  if (!d || typing(e) || e.repeat || ui.querySelector('.overlay') || ending.active) return;
  for (const c of testCodes) if (c.hit(d)) testUnlock(c.solveAll);
});

/** Pratik: konunun bir aşaması yeni sayılarla; kaynak harcamaz, yalnız tekrar kaydını günceller. */
function openPractice(key: string): void {
  const def = allStages().find((s) => topicKey(s.course, s.topic) === key);
  if (!def) return;
  hub.suspend();
  const run = prepareStage(def, 1 + Math.floor(Math.random() * 2 ** 30));
  run.open({
    root: ui,
    title: `Pratik — ${def.title}`,
    briefing: def.briefing,
    onSound: uiSound,
    onCancel: () => hub.resume(),
    onSubmit: (answer) => {
      const { result } = run.evaluate(answer, createRng(Date.now() % 2 ** 31));
      progress.review = recordReview(progress.review, key, result.success, Date.now());
      void persist();
      renderHud();
      result.facts.push({ label: 'Pratik', value: 'Kaynak etkisi yok; tekrar kaydı güncellendi' });
      showIncidentReport(ui, result, {
        onSound: uiSound,
        onRetry: () => openPractice(key),
        onClose: () => hub.resume(),
      });
    },
  });
  attachHints(run.hints, false);
}

// --- Sezon finali: bütün arızalar onarılınca bir kez ---
function maybeFinale(): boolean {
  if (progress.world.seenLines.includes('finale') || !W.faults.every((f) => isSolved(f.id))) return false;
  progress.world.seenLines.push('finale');
  void persist();
  hub.suspend();
  showFinale(ui, {
    lines: spoken(content.story.lines.finale),
    after: spoken(content.story.lines['finale:stayed']),
    onChoose: (end) => {
      progress.ending = end;
      if (!progress.world.states.includes(`ending.${end}`)) progress.world.states.push(`ending.${end}`);
      void persist();
    },
    onLeave: () => ending.start(),
    stats: seasonStats(),
    onContinue: () => hub.resume(),
  });
  return true;
}

function seasonStats(): { label: string; value: string }[] {
  const reviewed = Object.values(progress.review);
  return [
    { label: 'Onarılan arıza', value: `${W.faults.length}/${W.faults.length}` },
    { label: 'Bölüm', value: String(progress.episode) },
    { label: 'Denenen konu', value: String(reviewed.length) },
    { label: 'Oturmuş konu (kutu ≥ 3)', value: String(reviewed.filter((r) => r.box >= 3).length) },
    { label: 'Açılan kayıt', value: `${unlockedLogs(STATION_LOGS, states()).length}/${STATION_LOGS.length}` },
    { label: 'Yaratık saldırısı', value: String(Object.values(progress.threats).reduce((a, t) => a + t.strikes, 0)) },
  ];
}

function openPuzzle(fid: string): void {
  uiSound('click');
  hub.suspend();
  map.toggle(false); // harita paneli bulmacanın ve raporun üstünü örtmesin
  const f = FAULTS.get(fid)!;
  const card = content.cards[f.card];
  const i = stageIndex(fid);
  const { def, run } = getRun(fid);
  run.open({
    root: ui,
    title: `${card.title} — Aşama ${i + 1}/${stagesOf(fid).length}: ${def.title}`,
    briefing: def.briefing,
    source: def.source && {
      label: `${def.source.topicName} (${def.source.courseName})`,
      onFlag: () => {
        // "Bu soru hatalı": şablon havuzdan çıkar; aşama başka bir problemle hazırlanır.
        library = flagTemplate(library, def.id);
        void persistLibrary();
        runs.delete(fid);
        hub.resume();
      },
    },
    onSound: uiSound,
    onCancel: () => hub.resume(),
    onSubmit: (answer) => void runAttempt(fid, answer),
  });
  attachWhy(OBJECTIVES.why[fid]);
  attachHints(run.hints, true);
}

async function runAttempt(fid: string, answer: unknown): Promise<void> {
  const f = FAULTS.get(fid)!;
  const i = stageIndex(fid);
  const total = stagesOf(fid).length;
  const { outcome, result } = getRun(fid).run.evaluate(answer, createRng(baseSeed * 31 + attempt + 7 * i + fidSalt(fid)));
  const success = outcome.kind === 'success';
  const final = success && i + 1 === total;
  const stageDef = getRun(fid).def;
  progress.review = recordReview(progress.review, topicKey(stageDef.course, stageDef.topic), success, Date.now());

  // Bedel ya da geri kazanım: çözücünün fiziksel sonucundan; hasar bu aşamaya bağlanır.
  progress.attemptsThisEpisode++;
  const step = applyOutcome(progress.resources, balance, stageKey(fid, i), outcome);
  progress.resources = step.state;
  const lost: Amounts = {};
  for (const e of step.events) {
    if (e.type === 'damage') for (const [id, v] of Object.entries(e.loss)) lost[id] = (lost[id] ?? 0) + v;
    if (e.type === 'repaired') result.facts.push({ label: 'Kaynak etkisi', value: fmtAmounts(e.gain, '+') });
  }
  const damage = step.events.find((e) => e.type === 'damage');
  if (damage) {
    result.facts.push({ label: 'Kaynak etkisi', value: fmtAmounts(lost, '−') });
    const sum = Object.values(lost).reduce((a, b) => a + b, 0);
    if (!progress.worstEvent || sum > progress.worstEvent.total) progress.worstEvent = { label: damage.label, total: sum };
  }
  const before = new Set(W.doors.filter((d) => doorOpen(d, states())).map((d) => d.id));
  if (success) progress.faults[fid] = { stagesDone: i + 1 };
  if (final) {
    progress.world.states = withProvided(states(), f);
    if (mapTarget === fid) mapTarget = null;
  }
  failurePulse = !success;
  const critical = isCritical(progress.resources, balance);
  if (critical) result.facts.push({ label: 'Durum', value: 'Kaynaklar kritik — odanın girişine dönülecek' });
  renderHud();
  updateMood(success ? CALM_DOWN_SECONDS : 2);
  void persist();

  await hub.applyOutcome(fid, outcome, { final, progressText: progressText(fid, i + 1), doorId: doorFor(fid) });
  if (hub.hasScorch(fid) && !progress.world.scorched.includes(fid)) {
    progress.world.scorched.push(fid);
    void persist();
  }
  if (final) {
    // Yeni sağlanan durumlar: kapılar açılır, bekleyen terminaller hazır olur.
    for (const d of W.doors) if (!before.has(d.id) && doorOpen(d, states())) hub.setDoorOpen(d.id, true, true);
    refreshAll();
    say(`solved:${fid}`);
  }

  const repair = () => {
    // Yedek parça: yeni deneme yeni sayılarla; kalıcı hasar onarılana kadar sürer.
    attempt++;
    runs.delete(fid);
    hub.repairForRetry(fid, doorFor(fid));
    refreshTerminal(fid);
    failurePulse = false;
    updateMood(CALM_DOWN_SECONDS);
  };

  showIncidentReport(ui, result, {
    onSound: uiSound,
    onNext: success && !final && !critical ? () => openPuzzle(fid) : undefined,
    onRetry: critical
      ? undefined
      : () => {
          repair();
          openPuzzle(fid);
        },
    onClose: () => {
      if (critical) return closeEpisode();
      if (!result.success) repair();
      if (final && maybeFinale()) return;
      hub.resume();
    },
  });
}

// Klasör kuyruğu oyun açılınca başlar (arka planda; anahtar gerekirse oyuncu dolaşırken bir kez sorulur).
materials.start();
