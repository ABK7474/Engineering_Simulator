// Dünya durumu (saf): hangi arızaya erişilebilir, hangi kapılar açık, oyuncu nereye gitmeli,
// başlangıçtan neler çözülebilir (erişilebilirlik).

import type { DoorDef, FaultDef, WorldDef } from './schema';

export type States = ReadonlySet<string> | readonly string[];

const has = (s: States, x: string) => (Array.isArray(s) ? s.includes(x) : (s as ReadonlySet<string>).has(x));

/** Arızanın eksik koşulları (boşsa etkileşime açık). */
export function missingFor(f: FaultDef, states: States): string[] {
  return f.requires.filter((r) => !has(states, r));
}

export function doorOpen(d: DoorDef, states: States): boolean {
  return d.opensWhen.every((s) => has(states, s));
}

export function openDoors(w: WorldDef, states: States): Set<string> {
  return new Set(w.doors.filter((d) => doorOpen(d, states)).map((d) => d.id));
}

/** Çözülen arızanın sağladığı durumlar eklenir. */
export function withProvided(states: States, f: FaultDef): string[] {
  const out = [...(Array.isArray(states) ? states : [...(states as ReadonlySet<string>)])];
  for (const p of f.provides) if (!out.includes(p)) out.push(p);
  return out;
}

export const providersOf = (w: WorldDef, state: string) => w.faults.filter((f) => f.provides.includes(state));

/**
 * Test kodu: bütün kapıları ve terminalleri açan durumlar (arızalar çözülmüş sayılmaz). Tehdit panolarının
 * sağladıkları (ör. threat.cleared) verilmez; yoksa tehdit hiç başlamaz ve pano denenemez.
 */
export function testUnlockStates(w: WorldDef, states: States): string[] {
  const boards = new Set(w.faults.filter((f) => f.event !== undefined).flatMap((f) => f.provides));
  const out = new Set(Array.isArray(states) ? states : [...(states as ReadonlySet<string>)]);
  for (const f of w.faults) for (const p of f.provides) if (!boards.has(p)) out.add(p);
  return [...out];
}

/** Başlangıçtan açık kapılarla ulaşılabilen odalar. */
export function reachableRooms(w: WorldDef, states: States): Set<string> {
  const seen = new Set([w.start.room]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of w.doors) {
      if (!doorOpen(d, states)) continue;
      const [a, b] = d.rooms;
      if (seen.has(a) !== seen.has(b)) {
        seen.add(a);
        seen.add(b);
        grew = true;
      }
    }
  }
  return seen;
}

/**
 * Oyuncu bir arızaya koşulu eksikken yaklaştı: o koşulu sağlayan, şu an çözülebilir arızayı bul
 * (zincirliyse en dipteki eyleme dönük olanı). Haritada hedef olarak gösterilir.
 */
export function nextGoal(w: WorldDef, states: States, solved: ReadonlySet<string>, blocked: FaultDef): FaultDef | null {
  const rooms = reachableRooms(w, states);
  const visit = (f: FaultDef, depth: number): FaultDef | null => {
    if (depth > w.faults.length) return null;
    for (const need of missingFor(f, states)) {
      for (const p of providersOf(w, need)) {
        if (solved.has(p.id)) continue;
        if (missingFor(p, states).length === 0 && rooms.has(p.room)) return p;
        const deeper = visit(p, depth + 1);
        if (deeper) return deeper;
      }
    }
    return null;
  };
  return visit(blocked, 0);
}

export interface Reachability {
  rooms: Set<string>;
  /** Çözülebilecekleri sırasıyla. */
  order: string[];
  states: Set<string>;
  unreachableRooms: string[];
  unsolvable: string[];
}

/** Başlangıçtan sabit nokta: ulaşılan odalar → çözülebilen arızalar → sağlanan durumlar → açılan kapılar… */
export function simulate(w: WorldDef): Reachability {
  const states = new Set(w.initialStates);
  const solved = new Set<string>();
  const order: string[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    const rooms = reachableRooms(w, states);
    for (const f of w.faults) {
      if (solved.has(f.id) || !rooms.has(f.room) || missingFor(f, states).length) continue;
      solved.add(f.id);
      order.push(f.id);
      f.provides.forEach((p) => states.add(p));
      progress = true;
    }
  }
  const rooms = reachableRooms(w, states);
  return {
    rooms,
    order,
    states,
    unreachableRooms: w.rooms.map((r) => r.id).filter((id) => !rooms.has(id)),
    unsolvable: w.faults.map((f) => f.id).filter((id) => !solved.has(id)),
  };
}

/** requires grafında döngü (arıza → koşulunu sağlayan arıza). Bulursa yolu döndürür: [a, b, a]. */
export function findCycle(w: WorldDef): string[] | null {
  const deps = new Map(w.faults.map((f) => [f.id, [...new Set(f.requires.flatMap((s) => providersOf(w, s).map((p) => p.id)))]]));
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const dfs = (id: string): string[] | null => {
    color.set(id, 1);
    stack.push(id);
    for (const nxt of deps.get(id) ?? []) {
      if (color.get(nxt) === 1) return [...stack.slice(stack.indexOf(nxt)), nxt];
      if (!color.get(nxt)) {
        const c = dfs(nxt);
        if (c) return c;
      }
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };
  for (const f of w.faults) {
    if (!color.get(f.id)) {
      const c = dfs(f.id);
      if (c) return c;
    }
  }
  return null;
}
