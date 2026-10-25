// Oynayışlar arası bilgi (ilerleme sıfırlansa da kalır): prolog bir kez görüldü mü. Yedeğe girmez;
// yalnız "Prologu atla" seçeneğini açar.

import type { Kv } from './kv';

export interface Meta {
  prologueSeen: boolean;
}

const KEY = 'meta';

export async function loadMeta(kv: Kv): Promise<Meta> {
  try {
    const raw = (await kv.get(KEY)) as Partial<Meta> | undefined;
    return { prologueSeen: raw?.prologueSeen === true };
  } catch {
    return { prologueSeen: false };
  }
}

export async function saveMeta(kv: Kv, m: Meta): Promise<void> {
  try {
    await kv.set(KEY, m);
  } catch (e) {
    console.warn('Oyun bilgisi kaydedilemedi.', e);
  }
}
