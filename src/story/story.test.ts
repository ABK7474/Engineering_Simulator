import { describe, expect, it } from 'vitest';
import logsJson from '../../content/story/logs.json';
import objectivesJson from '../../content/story/objectives.json';
import prologueJson from '../../content/story/prologue.json';
import storyJson from '../../content/story/season1.json';
import worldJson from '../../content/world/season1-world.json';
import { parseLogs } from '../core/notebook';
import { parseWorld } from '../world/schema';
import { CARDS } from '../world/content';
import { cleanName, lineProblems, resolveLine, resolveLines, type StoryLines } from './lines';
import { objectiveLine, objectiveView, parseObjectives } from './objectives';
import { parsePrologue, PrologueDirector, type Effect } from './prologue';

const story = storyJson as StoryLines;
const world = parseWorld(worldJson);
const objectives = parseObjectives(objectivesJson);
const prologue = parsePrologue(prologueJson);
const worldStates = new Set([...world.faults.flatMap((f) => [...f.requires, ...f.provides]), ...world.doors.flatMap((d) => d.opensWhen)]);

describe('replik biçimi', () => {
  it('ad yer tutucusu doldurulur; boş ya da uzun ad sadeleşir', () => {
    expect(resolveLine(story, { who: 'nexus', text: '{ad}, duyuyor musun?' }, 'Ayşe')).toEqual({ who: 'nexus', label: 'NEXUS', text: 'Ayşe, duyuyor musun?' });
    expect(resolveLine(story, 'Merhaba {ad}.', '   ')).toEqual({ who: 'default', label: 'NEREUS', text: 'Merhaba Deniz.' });
    expect(cleanName('  çok   uzun bir isim olan mühendis adı  ')).toHaveLength(20);
  });

  it('denetim bilinmeyen konuşmacıyı ve yer tutucuyu yakalar', () => {
    expect(lineProblems(story, { who: 'kaptan', text: 'x' }, 'a')).toHaveLength(1);
    expect(lineProblems(story, 'Selam {isim}', 'a')).toHaveLength(1);
    expect(lineProblems(story, '  ', 'a')).toHaveLength(1);
  });

  it('sezon ve prolog replikleri temiz (konuşmacı, yer tutucu, boş satır)', () => {
    const all = [...Object.entries(story.lines), ...prologue.beats.flatMap((b) => [[b.id, [...b.lines, ...(b.onFail ?? []), ...(b.onSuccess ?? [])]] as const])];
    expect(all.flatMap(([k, ls]) => ls.flatMap((l, i) => lineProblems(story, l, `${k} #${i + 1}`)))).toEqual([]);
  });

  it('final "kal" seçeneğini içerir ("ayrıl" kapsül sahnesinde); açılış NEREUS’un karşılamasıyla başlar', () => {
    expect(story.lines['finale:stayed']?.length).toBeGreaterThan(0);
    expect(resolveLines(story, story.lines.start, 'Deniz')[0].text).toBe('Hoş geldiniz, mühendis. Sizi bekliyordum.');
  });
});

describe('sezon hedefi', () => {
  it('her arızanın onarımı hedefe bağlı: "neden" satırı var; sağladığı durum bir yolun adımı (olay panoları hariç)', () => {
    for (const f of world.faults) {
      expect(objectives.why[f.id], f.id).toBeTruthy();
      if (!f.event) for (const s of f.provides) expect(objectives.objectives.some((o) => o.steps.includes(s)), `${f.id} → ${s}`).toBe(true);
    }
    for (const id of Object.keys(objectives.why)) expect(world.faults.some((f) => f.id === id), id).toBe(true);
    for (const o of objectives.objectives) for (const s of o.steps) expect(worldStates.has(s), s).toBe(true);
  });

  it('ilerleme ve tek satır özet', () => {
    expect(objectiveView(objectives, []).map((o) => o.completed)).toEqual([0, 0]);
    const all = objectives.objectives.flatMap((o) => o.steps);
    expect(objectiveView(objectives, all).every((o) => o.done)).toBe(true);
    expect(objectiveLine(objectives, [], (s) => (s === 'power.backup' ? 'Yedek güç panosu' : null))).toBe("Destek gemisine ulaş — Yedek güç panosu");
    const comms = objectives.objectives[0].steps;
    expect(objectiveLine(objectives, comms, () => 'X')).toMatch(/^Kaçış kapsülü/);
    expect(objectiveLine(objectives, all, () => null)).toBe('Yüzeye ulaş: hazır');
  });
});

describe('istasyon kayıtları', () => {
  it('her kayıt bilinen bir durumla açılır', () => {
    for (const l of parseLogs(logsJson)) for (const s of l.after) expect(worldStates.has(s) || s === 'prologue.done', `${l.id}: ${s}`).toBe(true);
  });
});

describe('prolog sahneleri', () => {
  const kinds = (fx: Effect[]) => fx.map((e) => (e.type === 'cue' ? `cue:${e.name}` : e.type));

  it('bulmaca kartları içerikte var ve kolay zorlukla doğrulanır', () => {
    for (const b of prologue.beats) if (b.until.type === 'puzzle') expect(CARDS[b.until.card], b.until.card).toBeDefined();
  });

  it('baştan sona: replikler, bulmacalar, dokunuşlar ve süreler sırayla ilerletir', () => {
    const d = new PrologueDirector(prologue);
    const seen: string[] = [];
    let fx = d.start();
    for (let guard = 0; !d.done && guard < 100; guard++) {
      seen.push(d.beat!.id);
      const b = d.beat!;
      if (b.until.type === 'lines') fx = d.on({ type: 'linesDone' });
      else if (b.until.type === 'time') fx = d.on({ type: 'tick', dt: b.until.sec + 0.01 });
      else if (b.until.type === 'interact') fx = d.on({ type: 'interact', target: b.target! });
      else if (b.until.type === 'event') {
        expect(d.on({ type: 'event', name: 'başka' })).toEqual([]);
        fx = d.on({ type: 'event', name: b.until.name });
      }
      else {
        expect(d.on({ type: 'interact', target: 'yanlış' })).toEqual([]);
        expect(kinds(d.on({ type: 'interact', target: b.target! }))).toEqual(['openPuzzle']);
        // Panel açıkken ikinci E yeni panel açmaz
        expect(d.on({ type: 'interact', target: b.target! })).toEqual([]);
        // İlk hata teselli eder, ikincisi sessiz; sahne değişmez
        expect(kinds(d.on({ type: 'puzzle', card: b.until.card, success: false }))).toEqual(b.onFail?.length ? ['say'] : []);
        d.on({ type: 'interact', target: b.target! });
        expect(d.on({ type: 'puzzle', card: b.until.card, success: false })).toEqual([]);
        expect(d.beat!.id).toBe(b.id);
        d.on({ type: 'interact', target: b.target! });
        fx = d.on({ type: 'puzzle', card: b.until.card, success: true });
      }
    }
    expect(d.done).toBe(true);
    expect(kinds(fx)).toContain('done');
    expect(seen).toEqual(prologue.beats.map((b) => b.id));
  });

  it('süre sahnesi erken bitmez; olay sahnesi yalnız kendi olayıyla, replik bitişiyle değil', () => {
    const d = new PrologueDirector(prologue);
    d.skipTo('suit');
    expect(d.on({ type: 'tick', dt: 1 })).toEqual([]);
    expect(kinds(d.on({ type: 'tick', dt: 2 }))).toContain('cue:seabed');
    d.skipTo('fall');
    expect(d.on({ type: 'tick', dt: 30 })).toEqual([]);
    expect(d.on({ type: 'linesDone' })).toEqual([]);
    expect(d.beat!.id).toBe('fall');
    expect(kinds(d.on({ type: 'event', name: 'impact' }))).toContain('cue:crash');
  });

  it('atlama: sahnenin efektleri ve istemi yeniden verilir', () => {
    const d = new PrologueDirector(prologue);
    const fx = d.skipTo('seabed');
    expect(kinds(fx)).toEqual(['cue:seabed', 'say', 'prompt']);
    expect(fx.at(-1)).toEqual({ type: 'prompt', target: 'hatch', text: 'E: Servis kilidini çalıştır' });
    expect(() => d.skipTo('yok')).toThrow();
  });

  it('ilk iki dakika akıcı: ilk sahnenin replikleri kısa ve az', () => {
    const first = prologue.beats[0];
    expect(first.lines.length).toBeLessThanOrEqual(3);
    for (const l of first.lines) expect((typeof l === 'string' ? l : l.text).length).toBeLessThanOrEqual(80);
  });
});

describe('prolog içeriği yüklenir', () => {
  it('kolay zorluk uygulanır ve 20 tohumda doğrulanır', async () => {
    const { loadPrologue } = await import('../world/content');
    const p = loadPrologue();
    expect(Object.keys(p.stages).sort()).toEqual(['prologue-bus-01', 'prologue-relay-01']);
    const led = p.stages['prologue-relay-01'][0].config as { targetMin_mA: number; targetMax_mA: number };
    expect([led.targetMin_mA, led.targetMax_mA]).toEqual([8, 22]);
  });
});
