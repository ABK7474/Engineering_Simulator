// Prolog sahne durum makinesi (saf, Three.js'siz). Her sahne: başında tetiklenen efektler (cue), söylenen
// replikler ve bitiş koşulu (replikler biter / bulmaca çözülür / bir şeye E ile dokunulur / süre). Akış olayları
// içeri verir, çıkan efektleri uygular. Böylece sıra, atlama ve ileri sarma testlenir.

import type { Line } from './lines';

export type Until =
  | { type: 'lines' }
  | { type: 'time'; sec: number }
  | { type: 'interact' }
  | { type: 'puzzle'; card: string }
  /** Sahnedeki bir olay (ör. denizaltı tabana vurdu, oyuncu içeri alındı); oyun saatine bağlı animasyonlar için. */
  | { type: 'event'; name: string };

export interface Beat {
  id: string;
  cues: string[];
  lines: Line[];
  /** E ile etkileşilen nesne (kokpitte röle kutusu, dolap; tabanda kilit). */
  target?: string;
  prompt?: string;
  until: Until;
  onFail?: Line[];
  onSuccess?: Line[];
}

export interface PrologueDef {
  difficulty: Record<string, unknown>;
  /** Müren'in kaynakları kritikleşince (bölüm kapanmaz, yedek hücreye geçilir). */
  reserve?: Line[];
  beats: Beat[];
}

export type Effect =
  | { type: 'cue'; name: string }
  | { type: 'say'; lines: Line[] }
  | { type: 'prompt'; target: string | null; text?: string }
  | { type: 'openPuzzle'; card: string }
  | { type: 'done' };

export type PrologueEvent =
  | { type: 'linesDone' }
  | { type: 'tick'; dt: number }
  | { type: 'interact'; target: string }
  | { type: 'puzzle'; card: string; success: boolean }
  | { type: 'event'; name: string };

export function parsePrologue(raw: unknown, file = 'prologue.json'): PrologueDef {
  const d = raw as PrologueDef;
  if (!Array.isArray(d?.beats) || !d.beats.length) throw new Error(`${file}: sahne yok`);
  const ids = new Set<string>();
  for (const b of d.beats) {
    if (typeof b.id !== 'string' || ids.has(b.id)) throw new Error(`${file}: sahne kimliği eksik/yinelenmiş (${String(b?.id)})`);
    ids.add(b.id);
    if (!Array.isArray(b.cues) || !Array.isArray(b.lines)) throw new Error(`${file} '${b.id}': cues/lines dizi olmalı`);
    const u = b.until;
    if (!u || !['lines', 'time', 'interact', 'puzzle', 'event'].includes(u.type)) throw new Error(`${file} '${b.id}': bitiş koşulu geçersiz`);
    if ((u.type === 'interact' || u.type === 'puzzle') && !b.target) throw new Error(`${file} '${b.id}': etkileşim hedefi yok`);
    if (u.type === 'puzzle' && typeof u.card !== 'string') throw new Error(`${file} '${b.id}': bulmaca kartı yok`);
    if (u.type === 'event' && typeof u.name !== 'string') throw new Error(`${file} '${b.id}': olay adı yok`);
    if (u.type === 'time' && !(u.sec > 0)) throw new Error(`${file} '${b.id}': süre geçersiz`);
    if (u.type === 'lines' && !b.lines.length) throw new Error(`${file} '${b.id}': replik yokken 'lines' koşulu bitmez`);
  }
  return d;
}

export class PrologueDirector {
  index = -1;
  done = false;
  private elapsed = 0;
  private failed = false;
  /** Bu sahnede bulmaca açık mı (aynı anda ikinci kez açılmasın). */
  puzzleOpen = false;

  constructor(readonly def: Pick<PrologueDef, 'beats'>) {}

  get beat(): Beat | null {
    return this.def.beats[this.index] ?? null;
  }

  start(): Effect[] {
    return this.enter(0);
  }

  /** Geliştirme/test: doğrudan bir sahneye (kimlik ya da sıra) atla. */
  skipTo(beat: string | number): Effect[] {
    const i = typeof beat === 'number' ? beat : this.def.beats.findIndex((b) => b.id === beat);
    if (i < 0 || i >= this.def.beats.length) throw new Error(`prolog: sahne yok (${beat})`);
    return this.enter(i);
  }

  on(e: PrologueEvent): Effect[] {
    const b = this.beat;
    if (this.done || !b) return [];
    switch (e.type) {
      case 'linesDone':
        return b.until.type === 'lines' ? this.enter(this.index + 1) : [];
      case 'tick':
        if (b.until.type !== 'time') return [];
        this.elapsed += e.dt;
        return this.elapsed >= b.until.sec ? this.enter(this.index + 1) : [];
      case 'interact':
        if (e.target !== b.target) return [];
        if (b.until.type === 'interact') return this.enter(this.index + 1);
        if (b.until.type === 'puzzle' && !this.puzzleOpen) {
          this.puzzleOpen = true;
          return [{ type: 'openPuzzle', card: b.until.card }];
        }
        return [];
      case 'event':
        return b.until.type === 'event' && b.until.name === e.name ? this.enter(this.index + 1) : [];
      case 'puzzle': {
        if (b.until.type !== 'puzzle' || e.card !== b.until.card) return [];
        this.puzzleOpen = false;
        if (!e.success) {
          // Teselli bir kez; sonraki denemelerde yalnız olay raporu konuşur
          if (this.failed || !b.onFail?.length) return [];
          this.failed = true;
          return [{ type: 'say', lines: b.onFail }];
        }
        const out: Effect[] = b.onSuccess?.length ? [{ type: 'say', lines: b.onSuccess }] : [];
        return [...out, ...this.enter(this.index + 1)];
      }
    }
  }

  /** Bulmaca paneli sonuçsuz kapandı (vazgeç): yeniden açılabilsin. */
  puzzleClosed(): void {
    this.puzzleOpen = false;
  }

  private enter(i: number): Effect[] {
    this.elapsed = 0;
    this.failed = false;
    this.puzzleOpen = false;
    if (i >= this.def.beats.length) {
      this.index = this.def.beats.length;
      this.done = true;
      return [{ type: 'prompt', target: null }, { type: 'done' }];
    }
    this.index = i;
    const b = this.def.beats[i];
    return [
      ...b.cues.map((name): Effect => ({ type: 'cue', name })),
      ...(b.lines.length ? [{ type: 'say', lines: b.lines } as Effect] : []),
      b.target ? { type: 'prompt', target: b.target, text: b.prompt } : { type: 'prompt', target: null },
    ];
  }
}
