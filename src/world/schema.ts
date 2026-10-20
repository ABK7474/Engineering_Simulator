// Dünya içeriğinin tipleri ve yapısal ayrıştırması (content/world/*.json).
// Anlamsal kurallar (komşuluk, erişilebilirlik, döngüler…) validate.ts'te.

import { CORRUPTION_KINDS, type CorruptionKind, type Kind } from '../solvers/ds/ir';

export type Side = 'north' | 'south' | 'east' | 'west';
export const SIDES: readonly Side[] = ['north', 'south', 'east', 'west'];

export interface WallSpec {
  windows?: number[];
  broken?: number[];
  hangingCables?: number[];
}

export interface Difficulty {
  /** Seri-paralel aşamada kutudaki aday direnç sayısı (topoloji sabit; "bileşen sayısı"). */
  binSize?: number;
  /** Hedef toleransı (oran). */
  tolerance?: number;
  /** Seri LED aşamasında hedef akım aralığı [min, max] mA. */
  ledWindow_mA?: [number, number];
  /** Trace (veri yapıları) aşaması: işlem sayısı, yapı türleri, hata türleri, sayaçları gizleme. */
  trace?: { ops?: [number, number]; structures?: Kind[]; corruptions?: CorruptionKind[]; hideCounters?: boolean };
  /** Thevenin aşaması: istenen biçim ve kabul toleransı. */
  thevenin?: { form?: 'thevenin' | 'norton'; tolerance?: number };
  /** Max-power aşaması: kutudaki yük sayısı. */
  maxPower?: { binSize?: number };
}

export interface PropDef {
  model: string;
  /** Oda içi konum: u = batı duvarından doğuya, v = kuzey duvarından güneye (m). */
  u: number;
  v: number;
  rotY: number;
}

export interface RoomDef {
  id: string;
  name: string;
  /** corridor: tek modül genişliğinde, kolonlu; room: gerçek oda. */
  type: 'corridor' | 'room';
  /** Kuzeybatı köşesi [x, z]; oda +x (doğu) ve −z (güney) yönünde uzanır. */
  origin: [number, number];
  /** Modül sayısı [doğu-batı, kuzey-güney]; modül 4 m. */
  size: [number, number];
  walls: Partial<Record<Side, WallSpec>>;
  entrance: { x: number; z: number; yaw: number };
  props: PropDef[];
  difficulty: Difficulty;
}

export interface DoorDef {
  id: string;
  rooms: [string, string];
  at: { room: string; wall: Side; index: number };
  opensWhen: string[];
}

export type TerminalModel = 'Prop_AccessPoint' | 'Prop_Computer';

export interface FaultDef {
  id: string;
  card: string;
  room: string;
  model: TerminalModel;
  anchor: { wall: Side; index: number; along: number };
  requires: string[];
  provides: string[];
  /** Kullanıcının konu şablonları bu arızanın aşamalarında kullanılabilir. */
  allowTopicTemplates?: boolean;
  /** Terminal ekran metinleri (\n satır böler). */
  screen?: { fault?: string; blocked?: string; solved?: string };
  /** Koşul eksikken terminal yanındaki ipucu (ör. "Güç yok — haritaya bak"). */
  blockedHint?: string;
}

export interface WorldDef {
  version: 1;
  start: { room: string };
  initialStates: string[];
  rooms: RoomDef[];
  doors: DoorDef[];
  faults: FaultDef[];
}

export class WorldError extends Error {
  constructor(readonly problems: string[]) {
    super(`Dünya içeriği geçersiz:\n- ${problems.join('\n- ')}`);
    this.name = 'WorldError';
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => Number.isInteger(x);
const strList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const pair = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(isNum);

/** Yapısal denetim: alanlar, tipler. Bütün sorunları toplar, sonunda tek hata fırlatır. */
export function parseWorld(raw: unknown): WorldDef {
  const p: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) p.push(msg);
    return cond;
  };
  if (!isObj(raw)) throw new WorldError(['kök nesne değil']);
  need(raw.version === 1, "version 1 olmalı");
  need(isObj(raw.start) && isStr((raw.start as Record<string, unknown>).room), 'start.room eksik');
  need(raw.initialStates === undefined || strList(raw.initialStates), 'initialStates metin dizisi olmalı');
  if (!need(Array.isArray(raw.rooms) && raw.rooms.length > 0, 'rooms boş ya da dizi değil')) throw new WorldError(p);

  (raw.rooms as unknown[]).forEach((r, i) => {
    const at = `rooms[${i}]`;
    if (!need(isObj(r), `${at} nesne değil`)) return;
    const o = r as Record<string, unknown>;
    const id = isStr(o.id) ? o.id : at;
    need(isStr(o.id), `${at}.id eksik`);
    need(isStr(o.name), `oda '${id}': name eksik`);
    need(o.type === 'corridor' || o.type === 'room', `oda '${id}': type 'corridor' ya da 'room' olmalı`);
    need(pair(o.origin), `oda '${id}': origin [x, z] olmalı`);
    need(pair(o.size) && (o.size as number[]).every((n) => isInt(n) && n >= 1 && n <= 12), `oda '${id}': size 1–12 tamsayı çifti olmalı`);
    need(isObj(o.walls), `oda '${id}': walls nesne olmalı`);
    if (isObj(o.walls)) {
      for (const [side, w] of Object.entries(o.walls)) {
        if (!need(SIDES.includes(side as Side), `oda '${id}': bilinmeyen duvar '${side}'`)) continue;
        if (!need(isObj(w), `oda '${id}': duvar '${side}' nesne olmalı`)) continue;
        for (const [k, v] of Object.entries(w as object)) {
          need(['windows', 'broken', 'hangingCables'].includes(k), `oda '${id}' ${side}: bilinmeyen alan '${k}'`);
          need(Array.isArray(v) && v.every((n) => isInt(n) && n >= 0), `oda '${id}' ${side}.${k}: negatif olmayan tamsayı dizisi olmalı`);
        }
      }
    }
    const e = o.entrance as Record<string, unknown>;
    need(isObj(e) && isNum(e.x) && isNum(e.z) && isNum(e.yaw), `oda '${id}': entrance {x, z, yaw} olmalı`);
    need(Array.isArray(o.props), `oda '${id}': props dizi olmalı`);
    if (Array.isArray(o.props)) {
      o.props.forEach((pr, k) => {
        const q = pr as Record<string, unknown>;
        need(isObj(pr) && isStr(q.model) && isNum(q.u) && isNum(q.v) && isNum(q.rotY), `oda '${id}' props[${k}]: {model, u, v, rotY} olmalı`);
      });
    }
    const d = o.difficulty as Record<string, unknown>;
    if (need(isObj(d), `oda '${id}': difficulty nesne olmalı`)) {
      need(d.binSize === undefined || (isInt(d.binSize) && (d.binSize as number) >= 4 && (d.binSize as number) <= 10), `oda '${id}': binSize 4–10 olmalı`);
      need(d.tolerance === undefined || (isNum(d.tolerance) && d.tolerance >= 0.015 && d.tolerance <= 0.1), `oda '${id}': tolerance 0,015–0,1 olmalı`);
      const tr = d.trace as Record<string, unknown> | undefined;
      if (tr !== undefined && need(isObj(tr), `oda '${id}': trace nesne olmalı`)) {
        need(tr.ops === undefined || (pair(tr.ops) && isInt(tr.ops[0]) && isInt(tr.ops[1]) && tr.ops[0] >= 3 && tr.ops[0] <= tr.ops[1]), `oda '${id}': trace.ops [min, max] olmalı`);
        need(tr.structures === undefined || (Array.isArray(tr.structures) && tr.structures.length > 0 && tr.structures.every((k) => ['stack', 'queue', 'list'].includes(k))), `oda '${id}': trace.structures stack/queue/list olmalı`);
        need(tr.corruptions === undefined || (Array.isArray(tr.corruptions) && tr.corruptions.length > 0 && tr.corruptions.every((k) => (CORRUPTION_KINDS as readonly unknown[]).includes(k))), `oda '${id}': trace.corruptions ${CORRUPTION_KINDS.join('/')} olmalı`);
        need(tr.hideCounters === undefined || typeof tr.hideCounters === 'boolean', `oda '${id}': trace.hideCounters true/false olmalı`);
      }
      const th = d.thevenin as Record<string, unknown> | undefined;
      if (th !== undefined && need(isObj(th), `oda '${id}': thevenin nesne olmalı`)) {
        need(th.form === undefined || th.form === 'thevenin' || th.form === 'norton', `oda '${id}': thevenin.form thevenin/norton olmalı`);
        need(th.tolerance === undefined || (isNum(th.tolerance) && th.tolerance > 0 && th.tolerance <= 0.1), `oda '${id}': thevenin.tolerance 0–0,1 olmalı`);
      }
      const mp = d.maxPower as Record<string, unknown> | undefined;
      if (mp !== undefined && need(isObj(mp), `oda '${id}': maxPower nesne olmalı`)) {
        need(mp.binSize === undefined || (isInt(mp.binSize) && mp.binSize >= 3 && mp.binSize <= 7), `oda '${id}': maxPower.binSize 3–7 olmalı`);
      }
      need(d.ledWindow_mA === undefined || (pair(d.ledWindow_mA) && d.ledWindow_mA[0] > 0 && d.ledWindow_mA[0] < d.ledWindow_mA[1]), `oda '${id}': ledWindow_mA [min, max] olmalı`);
    }
  });

  need(Array.isArray(raw.doors), 'doors dizi olmalı');
  (Array.isArray(raw.doors) ? raw.doors : []).forEach((d, i) => {
    const o = d as Record<string, unknown>;
    const at = o?.at as Record<string, unknown>;
    need(
      isObj(d) && isStr(o.id) && Array.isArray(o.rooms) && o.rooms.length === 2 && strList(o.rooms) && strList(o.opensWhen) &&
        isObj(at) && isStr(at.room) && SIDES.includes(at.wall as Side) && isInt(at.index),
      `doors[${i}]: {id, rooms:[a,b], at:{room, wall, index}, opensWhen[]} olmalı`,
    );
  });

  need(Array.isArray(raw.faults), 'faults dizi olmalı');
  (Array.isArray(raw.faults) ? raw.faults : []).forEach((f, i) => {
    const o = f as Record<string, unknown>;
    const a = o?.anchor as Record<string, unknown>;
    const id = isObj(f) && isStr(o.id) ? o.id : `faults[${i}]`;
    need(isObj(f) && isStr(o.id) && isStr(o.card) && isStr(o.room), `${id}: {id, card, room} eksik`);
    need(o?.model === 'Prop_AccessPoint' || o?.model === 'Prop_Computer', `arıza '${id}': model Prop_AccessPoint ya da Prop_Computer olmalı`);
    need(isObj(a) && SIDES.includes(a.wall as Side) && isInt(a.index) && isNum(a.along) && (a.along as number) >= 0 && (a.along as number) <= 1, `arıza '${id}': anchor {wall, index, along 0–1} olmalı`);
    need(strList(o?.requires) && strList(o?.provides), `arıza '${id}': requires/provides metin dizisi olmalı`);
    need(o?.allowTopicTemplates === undefined || typeof o.allowTopicTemplates === 'boolean', `arıza '${id}': allowTopicTemplates boolean olmalı`);
    const sc = o?.screen as Record<string, unknown> | undefined;
    need(sc === undefined || (isObj(sc) && Object.entries(sc).every(([k, v]) => ['fault', 'blocked', 'solved'].includes(k) && isStr(v))), `arıza '${id}': screen {fault, blocked, solved} metinleri olmalı`);
    need(o?.blockedHint === undefined || isStr(o.blockedHint), `arıza '${id}': blockedHint metin olmalı`);
  });

  if (p.length) throw new WorldError(p);
  const w = raw as unknown as WorldDef;
  return { ...w, initialStates: w.initialStates ?? [] };
}
