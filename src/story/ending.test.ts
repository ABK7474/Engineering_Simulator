import { describe, expect, it } from 'vitest';
import endingJson from '../../content/story/ending.json';
import storyJson from '../../content/story/season1.json';
import { depthEvent, parseEnding } from './ending';
import { lineProblems, type StoryLines } from './lines';
import { PrologueDirector, type Effect } from './prologue';

const ending = parseEnding(endingJson);
const story = storyJson as unknown as StoryLines;

describe('kapsül finali içeriği', () => {
  it('replikler bilinen konuşmacılarla', () => {
    const problems = ending.beats.flatMap((b) => b.lines.flatMap((l, i) => lineProblems(story, l, `${b.id} #${i + 1}`)));
    expect(problems).toEqual([]);
  });

  it('eski "finale:left" replikleri sahneye taşındı', () => {
    expect(story.lines['finale:left']).toBeUndefined();
    expect(story.lines['finale:stayed']?.length).toBeGreaterThan(0);
  });

  it('yanlış biçim reddedilir', () => {
    const beat = (over: object) => ({ beats: [{ id: 'a', cues: [], lines: ['x'], until: { type: 'lines' }, ...over }] });
    expect(() => parseEnding(beat({ cues: ['uçur'] }))).toThrow(/bilinmeyen cue/);
    expect(() => parseEnding(beat({ until: { type: 'event', name: 'patla' } }))).toThrow(/bilinmeyen olay/);
    expect(() => parseEnding(beat({ target: 'relay', until: { type: 'puzzle', card: 'x' } }))).toThrow(/bulmaca/);
    const twoDepths = {
      beats: [
        { id: 'a', cues: [], lines: [], until: { type: 'event', name: 'depth:100' } },
        { id: 'b', cues: [], lines: [], until: { type: 'event', name: 'depth:150' } },
      ],
    };
    expect(() => parseEnding(twoDepths)).toThrow(/azalan/);
  });

  it('sahne olaylarıyla baştan sona oynar', () => {
    const d = new PrologueDirector(ending);
    const seen: string[] = [];
    let fx: Effect[] = d.start();
    let depth = 221;
    let guard = 0;
    while (!d.done && guard++ < 500) {
      const b = d.beat!;
      if (!seen.includes(b.id)) seen.push(b.id);
      // Akışın yaptığı gibi: replikler biter, derinlik azalır (eşik olayları), yaratık durur, yüzeye çıkılır, zaman akar
      fx = d.on({ type: 'linesDone' });
      if (d.beat !== b) continue;
      depth = Math.max(0, depth - 5);
      const u = b.until;
      if (u.type === 'event') {
        const th = depthEvent(u.name);
        if (th !== null && depth <= th) fx = d.on({ type: 'event', name: u.name });
        else if (u.name === 'creature:stop' || (u.name === 'surfaced' && depth === 0)) fx = d.on({ type: 'event', name: u.name });
      }
      if (d.beat === b) fx = d.on({ type: 'tick', dt: 1 });
    }
    expect(fx.some((e) => e.type === 'done')).toBe(true);
    expect(seen).toEqual(ending.beats.map((b) => b.id));
  });
});
