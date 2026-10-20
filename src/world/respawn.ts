// Kritik kaynakta yeniden başlama (oyun bitmez): oyuncu bulunduğu odanın girişinden devam eder.
// Kaynaklar başa döner; o odadaki tamamlanmamış arızaların aşamaları ve o odaya ait kalıcı hasarlar
// sıfırlanır; çözülmüş arızalar, sağlanmış durumlar ve diğer odaların durumu korunur.

import type { ProgressData } from '../core/progress';
import { createResources, type Balance } from '../core/resources';
import type { WorldDef } from './schema';

export function respawnInRoom(p: ProgressData, b: Balance, w: WorldDef, roomId: string, stageCount: (faultId: string) => number): ProgressData {
  const roomFaults = w.faults.filter((f) => f.room === roomId).map((f) => f.id);
  const unfinished = roomFaults.filter((id) => (p.faults[id]?.stagesDone ?? 0) < stageCount(id));
  const fresh = createResources(b);
  const faults = { ...p.faults };
  for (const id of unfinished) faults[id] = { stagesDone: 0 };
  const inRoom = (faultKey: string) => roomFaults.includes(faultKey.split('#')[0]);
  return {
    ...p,
    resources: { ...fresh, damages: p.resources.damages.filter((d) => !inRoom(d.faultId)) },
    faults,
    episode: p.episode + 1,
    attemptsThisEpisode: 0,
    worstEvent: null,
    world: { ...p.world, room: roomId },
  };
}
