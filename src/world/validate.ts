// Dünya içeriğinin anlamsal doğrulaması. Bütün sorunları açıklamalı olarak toplar.

import { buildWorldLayout, cellCount, insideAny, neighborCell, roomRect, type Rect } from './layout';
import { unreachable } from './walk';
import { WorldError, type Side, type WorldDef } from './schema';
import { findCycle, providersOf, simulate } from './state';
import { lineProblems, type StoryLines } from '../story/lines';

export type Story = StoryLines;

export interface WorldContext {
  /** Var olan arıza kartı kimlikleri. */
  cards: ReadonlySet<string>;
  /** Yüklenebilen model adları. */
  models: ReadonlySet<string>;
  story?: Story;
}

const overlap = (a: Rect, b: Rect) => a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minZ < b.maxZ - 1e-6 && b.minZ < a.maxZ - 1e-6;

export function validateWorld(w: WorldDef, ctx: WorldContext): string[] {
  const p: string[] = [];
  const roomIds = new Set(w.rooms.map((r) => r.id));

  // 1. Kimlikler
  const all = [...w.rooms.map((r) => r.id), ...w.doors.map((d) => d.id), ...w.faults.map((f) => f.id)];
  for (const id of new Set(all.filter((id, i) => all.indexOf(id) !== i))) p.push(`kimlik '${id}' birden fazla kez kullanılmış`);
  if (!roomIds.has(w.start.room)) p.push(`başlangıç odası '${w.start.room}' yok`);
  const startRoom = w.rooms.find((r) => r.id === w.start.room);
  if (startRoom && w.start.hatch) {
    const { wall, index } = w.start.hatch;
    if (index >= cellCount(startRoom, wall)) p.push(`servis kilidi: '${wall}' duvarında ${index}. hücre yok`);
    else if (neighborCell(w.rooms, startRoom, wall, index) || startRoom.walls[wall]?.windows?.includes(index) || w.doors.some((d) => d.at.room === startRoom.id && d.at.wall === wall && d.at.index === index))
      p.push('servis kilidi dışa bakan, penceresiz ve kapısız bir duvar hücresinde olmalı');
  }
  if (w.start.wreck && insideAny(w.rooms.map((r) => { const q = roomRect(r); return { minX: q.minX - 3, maxX: q.maxX + 3, minZ: q.minZ - 3, maxZ: q.maxZ + 3 }; }), w.start.wreck.x, w.start.wreck.z))
    p.push('enkaz istasyona 3 m’den yakın olmamalı');

  // 2. Odalar
  for (const r of w.rooms) {
    if (r.type === 'corridor' && r.size[0] !== 1) p.push(`koridor '${r.id}' tek modül genişliğinde olmalı (size[0] = 1)`);
    for (const [side, spec] of Object.entries(r.walls) as [Side, NonNullable<(typeof r.walls)[Side]>][]) {
      for (const [k, list] of Object.entries(spec)) {
        for (const i of list as number[]) if (i >= cellCount(r, side)) p.push(`oda '${r.id}' ${side}.${k}: dizin ${i} duvar dışında (0–${cellCount(r, side) - 1})`);
      }
      for (const i of spec.windows ?? []) {
        const nb = neighborCell(w.rooms, r, side, i);
        if (nb) p.push(`oda '${r.id}' ${side} penceresi ${i} dışarıya değil '${nb.room.id}' odasına bakıyor`);
      }
    }
    for (const pr of r.props) if (!ctx.models.has(pr.model)) p.push(`oda '${r.id}': bilinmeyen model '${pr.model}'`);
  }
  for (let i = 0; i < w.rooms.length; i++) {
    for (let j = i + 1; j < w.rooms.length; j++) {
      if (overlap(roomRect(w.rooms[i]), roomRect(w.rooms[j]))) p.push(`odalar '${w.rooms[i].id}' ve '${w.rooms[j].id}' üst üste biniyor`);
    }
  }

  // 3. Kapılar
  for (const d of w.doors) {
    for (const r of d.rooms) if (!roomIds.has(r)) p.push(`kapı '${d.id}': bilinmeyen oda '${r}'`);
    if (!d.rooms.includes(d.at.room)) p.push(`kapı '${d.id}': at.room bağladığı odalardan biri olmalı`);
    const a = w.rooms.find((r) => r.id === d.at.room);
    if (!a) continue;
    if (d.at.index >= cellCount(a, d.at.wall)) {
      p.push(`kapı '${d.id}': ${d.at.wall} duvarında dizin ${d.at.index} yok`);
      continue;
    }
    const other = d.rooms.find((r) => r !== d.at.room);
    const nb = neighborCell(w.rooms, a, d.at.wall, d.at.index);
    if (!nb || nb.room.id !== other) p.push(`kapı '${d.id}': '${d.at.room}' ${d.at.wall} duvarı ${d.at.index}, '${other}' odasıyla ortak bir duvar hücresi değil`);
    if (a.walls[d.at.wall]?.windows?.includes(d.at.index)) p.push(`kapı '${d.id}' bir pencere hücresinde`);
  }

  // 4. Arızalar
  const doorCells = new Set(w.doors.flatMap((d) => {
    const a = w.rooms.find((r) => r.id === d.at.room);
    const nb = a && d.at.index < cellCount(a, d.at.wall) ? neighborCell(w.rooms, a, d.at.wall, d.at.index) : null;
    return [`${d.at.room}/${d.at.wall}/${d.at.index}`, ...(nb ? [`${nb.room.id}/${nb.side}/${nb.index}`] : [])];
  }));
  for (const f of w.faults) {
    const r = w.rooms.find((x) => x.id === f.room);
    if (!r) {
      p.push(`arıza '${f.id}': bilinmeyen oda '${f.room}'`);
      continue;
    }
    if (!ctx.cards.has(f.card)) p.push(`arıza '${f.id}': bilinmeyen kart '${f.card}'`);
    if (f.anchor.index >= cellCount(r, f.anchor.wall)) p.push(`arıza '${f.id}': ${f.anchor.wall} duvarında dizin ${f.anchor.index} yok`);
    if (doorCells.has(`${r.id}/${f.anchor.wall}/${f.anchor.index}`)) p.push(`arıza '${f.id}' bir kapı hücresine yerleştirilmiş`);
    if (r.walls[f.anchor.wall]?.windows?.includes(f.anchor.index)) p.push(`arıza '${f.id}' bir pencere hücresine yerleştirilmiş`);
  }

  // 4b. Tehditler: başlama koşulları sağlanabilir; bitiren durumu olayın kendi panosu sağlar; olay durumu yalnız olaydan
  const threatIds = new Set(w.threats.map((t) => t.id));
  for (const f of w.faults) if (f.event !== undefined && !threatIds.has(f.event)) p.push(`arıza '${f.id}': bilinmeyen tehdit '${f.event}'`);
  for (const t of w.threats) {
    for (const s of t.after) if (!w.initialStates.includes(s) && providersOf(w, s).length === 0) p.push(`tehdit '${t.id}' '${s}' durumunu bekliyor ama hiçbir arıza bunu sağlamıyor`);
    if (!w.faults.some((f) => f.event === t.id && f.provides.includes(t.clearedBy))) p.push(`tehdit '${t.id}': '${t.clearedBy}' durumunu sağlayan bir olay panosu (event: '${t.id}') yok`);
    if (providersOf(w, t.activeState).length) p.push(`tehdit '${t.id}': '${t.activeState}' durumunu bir arıza sağlıyor; bu durum yalnız olaydan gelir`);
  }

  // 5. Durumlar: her istenen durumu bir arıza sağlamalı (ya da başlangıçta olmalı)
  const needed = [...w.faults.flatMap((f) => f.requires.map((s) => [s, `arıza '${f.id}'`])), ...w.doors.flatMap((d) => d.opensWhen.map((s) => [s, `kapı '${d.id}'`]))];
  for (const [s, who] of needed) {
    if (!w.initialStates.includes(s) && providersOf(w, s).length === 0) p.push(`${who} '${s}' durumunu istiyor ama hiçbir arıza bunu sağlamıyor`);
  }

  // 6. Döngüsel bağımlılık
  const cycle = findCycle(w);
  if (cycle) p.push(`döngüsel bağımlılık: ${cycle.join(' → ')}`);

  if (p.length) return p; // geometri ve erişilebilirlik, temel referanslar doğruysa anlamlı

  // 7. Erişilebilirlik
  const sim = simulate(w);
  for (const id of sim.unsolvable) {
    const f = w.faults.find((x) => x.id === id)!;
    const own = w.doors.some((d) => d.rooms.includes(f.room) && d.opensWhen.some((s) => f.provides.includes(s)));
    if (!sim.rooms.has(f.room) && own) p.push(`arıza '${id}', kendi açtığı kapının arkasında (oda '${f.room}')`);
    else if (!sim.rooms.has(f.room)) p.push(`arıza '${id}' ulaşılamayan bir odada ('${f.room}')`);
    else p.push(`arıza '${id}' çözülemiyor: koşulları (${f.requires.join(', ')}) hiçbir zaman sağlanmıyor`);
  }
  for (const id of sim.unreachableRooms) if (!p.some((x) => x.includes(`'${id}'`))) p.push(`oda '${id}' başlangıçtan ulaşılamıyor`);

  // 8. Yerleşim: eşyalar/terminaller çakışmasın; giriş noktaları boş ve odanın içinde
  const L = buildWorldLayout(w);
  const solids = L.colliders.filter((c) => c.tag !== 'wall');
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) if (overlap(solids[i], solids[j])) p.push(`eşya/terminal çakışması: (${fmtRect(solids[i])}) ile (${fmtRect(solids[j])})`);
  }
  for (const { def, rect } of L.rooms) {
    const e = def.entrance;
    if (!(e.x > rect.minX && e.x < rect.maxX && e.z > rect.minZ && e.z < rect.maxZ)) p.push(`oda '${def.id}': giriş noktası odanın dışında`);
    else if (insideAny(L.colliders, e.x, e.z)) p.push(`oda '${def.id}': giriş noktası bir engelin içinde`);
  }
  // Yürünebilirlik (kapılar açık sayılır): eşyalar hiçbir terminalin, girişin ya da kapının önünü kapatmasın
  if (!p.length) for (const t of unreachable(L)) p.push(`yürünemez: ${t.label} başlangıçtan erişilemiyor (eşya/kolon yolu kapatıyor)`);

  // 9. Replikler
  if (ctx.story) {
    const states = new Set([...w.faults.flatMap((f) => [...f.requires, ...f.provides]), ...w.doors.flatMap((d) => d.opensWhen)]);
    for (const key of Object.keys(ctx.story.lines)) {
      const [kind, id] = key.split(':');
      const ok =
        (kind === 'start' || kind === 'respawn' || kind === 'finale') && id === undefined
          ? true
          : kind === 'finale'
            ? id === 'left' || id === 'stayed'
          : kind === 'enter'
            ? roomIds.has(id)
            : kind === 'solved'
              ? w.faults.some((f) => f.id === id)
              : kind === 'blocked'
                ? states.has(id)
                : kind === 'threat'
                  ? threatIds.has(id) && ['start', 'warning', 'strike', 'cleared'].includes(key.split(':')[2])
                  : false;
      if (!ok) p.push(`replik anahtarı '${key}' hiçbir oda/arıza/duruma karşılık gelmiyor`);
      if (!Array.isArray(ctx.story.lines[key]) || !ctx.story.lines[key].length) p.push(`replik '${key}' boş`);
      else ctx.story.lines[key].forEach((l, i) => p.push(...lineProblems(ctx.story!, l, `replik '${key}' #${i + 1}`)));
    }
  }
  return p;
}

const fmtRect = (r: Rect) => `x ${r.minX.toFixed(2)}…${r.maxX.toFixed(2)}, z ${r.minZ.toFixed(2)}…${r.maxZ.toFixed(2)}`;

export function assertValidWorld(w: WorldDef, ctx: WorldContext): void {
  const p = validateWorld(w, ctx);
  if (p.length) throw new WorldError(p);
}
