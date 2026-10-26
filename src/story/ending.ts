// Kapsül finali (saf): content/story/ending.json, prologla aynı sahne makinesiyle (PrologueDirector) oynar. Burada
// yalnız biçim denetlenir: tanınan cue'lar, olay adları (derinlik eşikleri azalan sırada) ve bulmacasız akış.

import { parsePrologue, type Beat } from './prologue';

export const ENDING_CUES = [
  'capsule',
  'launch',
  'radio',
  'lightsOut',
  'sonarContact',
  'creatureFollow',
  'sonarLost',
  'searchlight',
  'boat',
  'look:console',
  'look:station',
  'look:creature',
  'look:up',
  'look:ship',
  'look:boat',
] as const;
export type EndingCue = (typeof ENDING_CUES)[number];
export type LookTarget = 'console' | 'station' | 'creature' | 'up' | 'ship' | 'boat';

/** Sahnenin gönderdiği olaylar (derinlik eşikleri `depth:N` ayrıca). */
export const ENDING_EVENTS = ['creature:stop', 'surfaced'] as const;

/** `depth:N` olayının eşiği (m); başka olaysa null. */
export function depthEvent(name: string): number | null {
  const m = /^depth:(\d+)$/.exec(name);
  return m ? Number(m[1]) : null;
}

export interface EndingDef {
  beats: Beat[];
}

export function parseEnding(raw: unknown): EndingDef {
  const { beats } = parsePrologue(raw, 'ending.json');
  const problems: string[] = [];
  let lastDepth = Infinity;
  for (const b of beats) {
    for (const c of b.cues) if (!(ENDING_CUES as readonly string[]).includes(c)) problems.push(`'${b.id}': bilinmeyen cue '${c}'`);
    const u = b.until;
    if (u.type === 'puzzle' || u.type === 'interact') problems.push(`'${b.id}': finalde bulmaca ya da etkileşim olmaz`);
    if (u.type !== 'event') continue;
    const d = depthEvent(u.name);
    if (d === null) {
      if (!(ENDING_EVENTS as readonly string[]).includes(u.name)) problems.push(`'${b.id}': bilinmeyen olay '${u.name}'`);
    } else if (d >= lastDepth) problems.push(`'${b.id}': derinlik eşikleri azalan sırada olmalı (${d} m)`);
    else lastDepth = d;
  }
  if (problems.length) throw new Error(`ending.json: ${problems.join('; ')}`);
  return { beats };
}
