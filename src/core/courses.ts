// Ders listesi (content/courses.json) ve aşama etiketleri. Her aşama bir derse ve konuya bağlıdır
// (aralıklı tekrar bu etiketlerle yapılacak). Etiket içerikte durur; ilerleme kayıtları etkilenmez.

import coursesJson from '../../content/courses.json';
import type { StageDef } from './types';

export const COURSE_IDS: readonly string[] = coursesJson.map((c) => c.id);
/** Konu etiketi: küçük harf, rakam, tire; kullanıcı konuları için "konu:<kimlik>". */
const TOPIC = /^[a-z0-9][a-z0-9-]*(:[A-Za-z0-9_-]+)?$/;

/** Aşamanın ders/konu etiketlerini denetler; eksik ya da geçersizse açıklamalı hata. */
export function checkStageTags(def: Pick<StageDef, 'id' | 'course' | 'topic'>): void {
  if (!def.course || !COURSE_IDS.includes(def.course)) {
    throw new Error(`Aşama '${def.id}': course etiketi eksik ya da bilinmiyor ('${def.course}'); geçerliler: ${COURSE_IDS.join(', ')}`);
  }
  if (!def.topic || !TOPIC.test(def.topic)) throw new Error(`Aşama '${def.id}': topic etiketi eksik ya da geçersiz ('${def.topic}')`);
}
