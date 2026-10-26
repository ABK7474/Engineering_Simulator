// ders_materyalleri/ klasör düzeni (saf; dev sunucusu eklentisi ve tarayıcı birlikte kullanır):
//   <ders>/notlar|konular/<dosya>.pdf         → ders notu
//   <ders>/sorular|ornek_sorular/<dosya>      → soru (PDF ya da görsel)
//   <ders>/kitaplar/<kitap>.pdf               → kitap (uzunsa bölünür, kısaysa not gibi işlenir; git dışında)
//   <ders>/kitaplar/<kitap>/<bölüm>.pdf       → kitabın bölümü, not gibi işlenir
// Ders adı klasörden gelir; content/courses.json'daki kimlik ya da adla eşleşir (büyük-küçük harf, Türkçe karakter,
// boşluk/tire/alt çizgi fark etmez).

import { normalizeName } from '../core/format';

export { normalizeName };

export type MaterialKind = 'notes' | 'questions' | 'book';

export interface CourseRef {
  id: string;
  name: string;
}

export interface Classified {
  courseDir: string;
  courseId: string | null;
  kind: MaterialKind;
  /** Kitaptan gelen not (bölüm ya da kısa kitap): onaylansa da tam .md repoya yazılmaz. */
  fromBook: boolean;
}

export function matchCourse(dir: string, courses: readonly CourseRef[]): string | null {
  const n = normalizeName(dir);
  return courses.find((c) => normalizeName(c.id) === n || normalizeName(c.name) === n)?.id ?? null;
}

const SUB: Record<string, MaterialKind> = {
  notlar: 'notes',
  konular: 'notes',
  sorular: 'questions',
  'ornek-sorular': 'questions',
  kitaplar: 'book',
};
export const subKind = (name: string): MaterialKind | null => SUB[normalizeName(name)] ?? null;

export const NOTE_EXT = ['.pdf'];
export const QUESTION_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
export const extOf = (p: string) => (/\.[^./]+$/.exec(p)?.[0] ?? '').toLowerCase();
export const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Göreli yolu (posix, kökten) sınıflandırır; düzene uymayan ya da desteklenmeyen dosya null. */
export function classify(rel: string, courses: readonly CourseRef[]): Classified | null {
  const parts = rel.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.') || p.startsWith('_'))) return null; // gizli ve yardımcı dosyalar (_bolumler.json)
  if (parts.length < 3) return null;
  const [courseDir, sub] = parts;
  const kind = subKind(sub);
  if (!kind) return null;
  const ext = extOf(rel);
  const courseId = matchCourse(courseDir, courses);
  if (kind === 'book') {
    if (ext !== '.pdf') return null;
    if (parts.length === 3) return { courseDir, courseId, kind: 'book', fromBook: true };
    if (parts.length === 4) return { courseDir, courseId, kind: 'notes', fromBook: true };
    return null;
  }
  if (parts.length !== 3) return null;
  if (!(kind === 'notes' ? NOTE_EXT : QUESTION_EXT).includes(ext)) return null;
  return { courseDir, courseId, kind, fromBook: false };
}

/** Dosya adından konu adı: uzantı atılır, _ ve - boşluk olur. */
export function topicNameFromFile(file: string): string {
  const base = file.split('/').pop()!.replace(/\.[^.]+$/, '');
  const name = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name ? name[0].toLocaleUpperCase('tr') + name.slice(1) : 'Adsız konu';
}

/** Dev sunucusunun listelediği dosya. */
export interface MaterialFile extends Classified {
  /** Kökten göreli, posix. */
  path: string;
  /** Konu adı (kitap bölümünde yer iminin başlığı). */
  name: string;
  bytes: number;
  sha256: string;
  /** Güvenilir sayfa sayısı (sunucu PDF'i açarak sayar); görsel ya da okunamayan PDF'te null. */
  pages: number | null;
}

export interface MaterialsListing {
  files: MaterialFile[];
  /** Hiçbir dersle eşleşmeyen ders klasörleri. */
  unmatched: string[];
  /** Düzene uymayan dosyalar (yanlış alt klasör, desteklenmeyen uzantı). */
  ignored: string[];
  /** Bölünmekte olan kitaplar. */
  splitting: string[];
}
