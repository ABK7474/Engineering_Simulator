// Sezon hedefi (saf): "Yüzeye ulaş" iki yoldan oluşur (haberleşme, kaçış kapsülü). Her yol dünya durumlarının
// sıralı listesidir; her arızanın "neden" satırı onarımı hedefe bağlar. İçerik content/story/objectives.json.

export interface Objective {
  id: string;
  title: string;
  summary: string;
  /** Sıralı durumlar; sonuncusu sağlanınca yol tamamdır. */
  steps: string[];
}

export interface ObjectivesDef {
  title: string;
  objectives: Objective[];
  /** Arıza kimliği → onarımın hedefe bağlantısı (kısa). */
  why: Record<string, string>;
}

export interface ObjectiveStatus {
  id: string;
  title: string;
  summary: string;
  done: boolean;
  completed: number;
  total: number;
  /** Sıradaki sağlanmamış durum (bitmişse null). */
  next: string | null;
}

export function parseObjectives(raw: unknown): ObjectivesDef {
  const d = raw as ObjectivesDef;
  if (typeof d?.title !== 'string' || !Array.isArray(d.objectives) || !d.objectives.length) throw new Error('objectives.json: başlık ya da hedef listesi yok');
  for (const o of d.objectives)
    if (typeof o.id !== 'string' || typeof o.title !== 'string' || !Array.isArray(o.steps) || !o.steps.length) throw new Error(`objectives.json: hedef '${String(o?.id)}' eksik`);
  if (typeof d.why !== 'object' || !d.why) throw new Error('objectives.json: why eşlemesi yok');
  return d;
}

export function objectiveView(def: ObjectivesDef, states: readonly string[]): ObjectiveStatus[] {
  return def.objectives.map((o) => {
    const completed = o.steps.filter((s) => states.includes(s)).length;
    const next = o.steps.find((s) => !states.includes(s)) ?? null;
    return { id: o.id, title: o.title, summary: o.summary, done: next === null, completed, total: o.steps.length, next };
  });
}

/** Tek satırlık hedef: ilk bitmemiş yol ve sıradaki adımın adı (adlandıran fonksiyon dışarıdan). */
export function objectiveLine(def: ObjectivesDef, states: readonly string[], nameOf: (state: string) => string | null): string {
  const open = objectiveView(def, states).find((o) => !o.done);
  if (!open) return `${def.title}: hazır`;
  const step = open.next && nameOf(open.next);
  return step ? `${open.title} — ${step}` : open.title;
}
