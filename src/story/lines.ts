// Replik biçimi (saf): satır düz metin (varsayılan konuşmacı) ya da {who, text}. Metindeki `{ad}` oyuncunun
// adıyla doldurulur. İçerik denetimi: bilinmeyen konuşmacı ya da yer tutucu, boş satır.

export type Line = string | { who: string; text: string };

export interface StoryLines {
  /** Varsayılan konuşmacının görünen adı (düz metin satırlar). */
  speaker: string;
  /** Konuşmacı kimliği → görünen ad (ör. ece → ECE). */
  speakers?: Record<string, string>;
  lines: Record<string, Line[]>;
}

export interface Spoken {
  /** Konuşmacı kimliği; düz metin satırlarda 'default'. */
  who: string;
  label: string;
  text: string;
}

export const DEFAULT_NAME = 'Deniz';
export const PLACEHOLDERS = ['ad'] as const;

/** Oyuncu adı: boşluklar sadeleşir, en fazla 20 karakter; boşsa varsayılan. */
export function cleanName(raw: string | undefined | null): string {
  const n = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return n || DEFAULT_NAME;
}

export const fillName = (text: string, name: string) => text.replace(/\{ad\}/g, cleanName(name));

export function resolveLine(story: StoryLines, line: Line, name: string): Spoken {
  if (typeof line === 'string') return { who: 'default', label: story.speaker, text: fillName(line, name) };
  return { who: line.who, label: story.speakers?.[line.who] ?? line.who.toUpperCase(), text: fillName(line.text, name) };
}

export const resolveLines = (story: StoryLines, lines: readonly Line[] | undefined, name: string): Spoken[] => (lines ?? []).map((l) => resolveLine(story, l, name));

/** Tek satırın sorunları (konuşmacı tanımlı mı, metin dolu mu, yer tutucular bilinen mi). */
export function lineProblems(story: Pick<StoryLines, 'speakers'>, line: unknown, where: string): string[] {
  const p: string[] = [];
  const text = typeof line === 'string' ? line : (line as { text?: unknown })?.text;
  if (typeof line !== 'string') {
    const who = (line as { who?: unknown })?.who;
    if (typeof who !== 'string' || !story.speakers?.[who]) p.push(`${where}: bilinmeyen konuşmacı '${String(who)}'`);
  }
  if (typeof text !== 'string' || !text.trim()) p.push(`${where}: boş satır`);
  else for (const m of text.matchAll(/\{([^}]*)\}/g)) if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) p.push(`${where}: bilinmeyen yer tutucu {${m[1]}}`);
  return p;
}
