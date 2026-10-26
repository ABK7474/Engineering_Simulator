// Tarayıcı tarafı: ders_materyalleri/ dev sunucusu istemcisi ve repodaki onaylı içerik.
// Dev istemcisi yalnız `import.meta.env.DEV` içinde çalışır; yayın derlemesinde bu dallar silinir ve /__materials'e hiç
// istek gitmez. Repodaki onaylı konular (content/library/) ve ders analizleri (content/analysis/) pakete girer; yayında
// içerik yalnız bunlar ve "Konu ekle" ile elle yüklenenlerdir.

import { parseCourseAnalysis, type CourseAnalysis } from '../core/analysis';
import { parseRepoTopic, type Topic } from '../core/library';
import type { MaterialsListing } from './course-match';

export const MATERIALS_ENABLED = import.meta.env.DEV;

const json = async <T>(r: Response): Promise<T> => {
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Dev sunucusu: HTTP ${r.status}`);
  return body;
};

export async function fetchListing(): Promise<MaterialsListing | null> {
  if (!import.meta.env.DEV) return null;
  try {
    return await json<MaterialsListing>(await fetch('/__materials/list', { cache: 'no-store' }));
  } catch (e) {
    console.warn('ders_materyalleri listesi alınamadı.', e);
    return null;
  }
}

export async function fetchMaterial(path: string): Promise<Uint8Array> {
  if (!import.meta.env.DEV) throw new Error('Klasör yalnız geliştirme sunucusunda.');
  const r = await fetch(`/__materials/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Dosya okunamadı (${path}): HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Onaylı konuyu repoya (content/library/) yazar; yazılan yolu döndürür. */
export async function writeApprovedTopic(topic: Topic): Promise<string | null> {
  if (!import.meta.env.DEV) return null;
  const r = await fetch('/__materials/approved', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic }) });
  return (await json<{ written: string }>(r)).written;
}

/** Ders analizini repoya (content/analysis/) yazar; null analiz dosyayı siler. */
export async function writeCourseAnalysis(courseId: string, analysis: CourseAnalysis | null): Promise<string | null> {
  if (!import.meta.env.DEV) return null;
  const r = await fetch('/__materials/analysis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ courseId, analysis }) });
  return (await json<{ written: string | null }>(r)).written;
}

/** Klasör değişince (dev sunucusu olayı) ve yedek olarak 10 sn'de bir. */
export function onMaterialsChanged(fn: () => void): void {
  if (!import.meta.env.DEV) return;
  import.meta.hot?.on('materials:changed', fn);
  setInterval(fn, 10_000);
}

// ---------------------------------------------------------------- repodaki onaylı içerik (yayında da)

const repoTopicFiles = import.meta.glob('/content/library/**/*.json', { eager: true, import: 'default' });
const repoAnalysisFiles = import.meta.glob('/content/analysis/*.json', { eager: true, import: 'default' });

export function repoTopics(): Topic[] {
  return Object.entries(repoTopicFiles).flatMap(([file, raw]) => {
    const t = parseRepoTopic(raw);
    if (!t) console.warn(`Geçersiz repo konusu atlandı: ${file}`);
    return t ? [t] : [];
  });
}

export function repoAnalyses(): CourseAnalysis[] {
  return Object.entries(repoAnalysisFiles).flatMap(([file, raw]) => {
    const a = parseCourseAnalysis(raw);
    if (!a) console.warn(`Geçersiz ders analizi atlandı: ${file}`);
    return a ? [a] : [];
  });
}
