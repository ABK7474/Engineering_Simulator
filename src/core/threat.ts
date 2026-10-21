// Tehdit olayı (saf durum makinesi, three.js'siz, test edilebilir). İçerik content/world/*.json → threats.
//   dormant → (after durumları sağlanınca) pending → (delaySec dolaşma süresi) active → (clearedBy sağlanınca) cleared
// active iken geri sayım yalnız oyuncu dolaşırken işler (panel açıkken durur, kaynak tüketimi gibi). Gürültü
// (hareketsiz/eğilme 0, yürüme 1, koşma 2) yaratığı hızlandırır: sayaç noise[n] katı hızla azalır. Sayaç biterse
// saldırı olur (kaynak kaybı); yaratık retrySec sonra yeniden gelir. Oyun bitmez.

export interface ThreatDef {
  id: string;
  /** Olayın başlaması için gereken durumlar. */
  after: string[];
  /** Koşullar sağlandıktan sonra başlamadan önceki dolaşma süresi (s). */
  delaySec: number;
  /** Başladıktan sonra saldırıya kadarki süre (s, gürültüsüz). */
  timeLimitSec: number;
  /** Saldırıdan sonra yeniden gelme süresi (s). */
  retrySec: number;
  /** Olay sürerken sağlanan durum (terminaller bunu bekler). */
  activeState: string;
  /** Bu durum sağlanınca olay biter. */
  clearedBy: string;
  /** Gürültü seviyesi 0, 1, 2 için sayaç hız çarpanı. */
  noise: [number, number, number];
}

export type ThreatPhase = 'dormant' | 'pending' | 'active' | 'cleared';

export interface ThreatState {
  phase: ThreatPhase;
  /** pending: başlamaya kalan; active: saldırıya kalan (s). */
  timer: number;
  strikes: number;
  /** Bu yaklaşmada verilen uyarı sayısı (kalan süre %50 ve %20'yi geçince). */
  warned: number;
}

export type ThreatEvent = { kind: 'pending' } | { kind: 'started' } | { kind: 'warning'; remaining: number } | { kind: 'strike'; strikes: number } | { kind: 'cleared' };

export const WARN_AT = [0.5, 0.2] as const;

export const initialThreat = (): ThreatState => ({ phase: 'dormant', timer: 0, strikes: 0, warned: 0 });

export function parseThreats(raw: unknown): ThreatDef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('threats dizi olmalı');
  const errors: string[] = [];
  const out = raw.map((t, i) => {
    const d = t as ThreatDef;
    const at = `threats[${i}]`;
    const need = (ok: unknown, m: string) => void (ok || errors.push(`${at}: ${m}`));
    need(typeof d?.id === 'string' && d.id.length > 0, 'id eksik');
    need(Array.isArray(d?.after) && d.after.length > 0 && d.after.every((s) => typeof s === 'string'), 'after durum listesi olmalı');
    for (const k of ['delaySec', 'timeLimitSec', 'retrySec'] as const) need(typeof d?.[k] === 'number' && d[k] > 0, `${k} pozitif sayı olmalı`);
    need(typeof d?.activeState === 'string' && typeof d?.clearedBy === 'string' && d.activeState !== d.clearedBy, 'activeState ve clearedBy farklı durumlar olmalı');
    need(Array.isArray(d?.noise) && d.noise.length === 3 && d.noise.every((x) => typeof x === 'number' && x > 0) && d.noise[0] <= d.noise[1] && d.noise[1] <= d.noise[2], 'noise 3 artan pozitif çarpan olmalı');
    return d;
  });
  if (errors.length) throw new Error(`Tehdit tanımı geçersiz:\n- ${errors.join('\n- ')}`);
  return out;
}

export function tickThreat(def: ThreatDef, st: ThreatState, input: { states: readonly string[]; dt: number; roaming: boolean; noise: 0 | 1 | 2 }): { state: ThreatState; events: ThreatEvent[] } {
  const events: ThreatEvent[] = [];
  let s = { ...st };
  if (s.phase !== 'cleared' && input.states.includes(def.clearedBy)) {
    return { state: { ...s, phase: 'cleared', timer: 0 }, events: s.phase === 'active' ? [{ kind: 'cleared' }] : [] };
  }
  if (s.phase === 'dormant' && def.after.every((x) => input.states.includes(x))) {
    s = { ...s, phase: 'pending', timer: def.delaySec };
    events.push({ kind: 'pending' });
  }
  if (!input.roaming) return { state: s, events };
  if (s.phase === 'pending') {
    s.timer -= input.dt;
    if (s.timer <= 0) {
      s = { ...s, phase: 'active', timer: def.timeLimitSec, warned: 0 };
      events.push({ kind: 'started' });
    }
  } else if (s.phase === 'active') {
    s.timer -= input.dt * def.noise[input.noise];
    const total = s.strikes ? def.retrySec : def.timeLimitSec;
    while (s.warned < WARN_AT.length && s.timer <= WARN_AT[s.warned] * total && s.timer > 0) {
      s.warned++;
      events.push({ kind: 'warning', remaining: s.timer });
    }
    if (s.timer <= 0) {
      s = { ...s, strikes: s.strikes + 1, timer: def.retrySec, warned: 0 };
      events.push({ kind: 'strike', strikes: s.strikes });
    }
  }
  return { state: s, events };
}

export function validThreatState(x: unknown): x is ThreatState {
  const o = x as ThreatState;
  return (
    typeof o === 'object' &&
    o !== null &&
    ['dormant', 'pending', 'active', 'cleared'].includes(o.phase) &&
    typeof o.timer === 'number' &&
    Number.isFinite(o.timer) &&
    Number.isInteger(o.strikes) &&
    o.strikes >= 0 &&
    Number.isInteger(o.warned) &&
    o.warned >= 0
  );
}
