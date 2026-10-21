// Dünya içeriğini yükler ve baştan sona doğrular: şema → anlamsal kurallar → oda zorluğuyla aşamalar.
// Kartlar content/faults/ altındaki bütün JSON'lardır; yeni arıza = yeni dosya.

import storyJson from '../../content/story/season1.json';
import worldJson from '../../content/world/season1-world.json';
import type { FaultCard, StageDef } from '../core/types';
import { MODEL_IDS } from './catalog';
import { faultStages, verifyFaultStages } from './difficulty';
import { buildWorldLayout, type WorldLayout } from './layout';
import { parseWorld, WorldError, type WorldDef } from './schema';
import { validateWorld, type Story } from './validate';

const cardModules = import.meta.glob<{ default: FaultCard }>('../../content/faults/*.json', { eager: true });
export const CARDS: Record<string, FaultCard> = Object.fromEntries(Object.values(cardModules).map((m) => [m.default.id, m.default]));

/** Yerleşimde kullanılabilen model adları (katalog). */
export const KNOWN_MODELS = new Set<string>(MODEL_IDS);

export interface WorldContent {
  world: WorldDef;
  layout: WorldLayout;
  story: Story;
  /** Arıza kimliği → oyunda kullanılacak aşamalar (oda zorluğu uygulanmış). */
  stages: Record<string, StageDef[]>;
  cards: Record<string, FaultCard>;
}

export function loadWorld(raw: unknown = worldJson, story: Story = storyJson as Story, cards = CARDS, opts: { verifySeeds?: number } = {}): WorldContent {
  const world = parseWorld(raw);
  const problems = validateWorld(world, { cards: new Set(Object.keys(cards)), models: KNOWN_MODELS, story });
  if (problems.length) throw new WorldError(problems);
  const stages: Record<string, StageDef[]> = {};
  for (const f of world.faults) {
    const room = world.rooms.find((r) => r.id === f.room)!;
    stages[f.id] = faultStages(cards[f.card], room.difficulty);
    if (opts.verifySeeds !== 0) problems.push(...verifyFaultStages(f.id, stages[f.id], opts.verifySeeds));
  }
  if (problems.length) throw new WorldError(problems);
  return { world, layout: buildWorldLayout(world), story, stages, cards };
}
