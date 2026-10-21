// Aralıklı tekrar (saf, test edilebilir): konu başına Leitner kutusu. Anahtar ders/konu etiketidir
// (`${course}/${topic}`), içerikteki aşama etiketlerinden gelir. Doğru cevap konuyu bir üst kutuya taşır ve
// tekrar aralığını uzatır; yanlış cevap 0. kutuya düşürür, konu kısa süre sonra yeniden gelir.

export interface ReviewItem {
  /** 0 (yeni yanlış) … 5 (oturmuş). */
  box: number;
  /** Bir sonraki tekrar zamanı (ms, Date.now ölçeği). */
  due: number;
  seen: number;
  correct: number;
  /** Son deneme zamanı (ms). */
  last: number;
}

export type ReviewState = Record<string, ReviewItem>;

export const MAX_BOX = 5;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Kutu → tekrar aralığı: 0 kutu 10 dk, sonra 1, 3, 7, 14, 30 gün. */
export const INTERVALS_MS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY] as const;

export const topicKey = (course: string, topic: string) => `${course}/${topic}`;

export function recordReview(s: ReviewState, key: string, success: boolean, now: number): ReviewState {
  const prev = s[key];
  const box = success ? Math.min(MAX_BOX, (prev?.box ?? 0) + 1) : 0;
  return {
    ...s,
    [key]: { box, due: now + INTERVALS_MS[box], seen: (prev?.seen ?? 0) + 1, correct: (prev?.correct ?? 0) + (success ? 1 : 0), last: now },
  };
}

/** Tekrar zamanı gelmiş konular, en gecikmiş önce. */
export function dueTopics(s: ReviewState, now: number): string[] {
  return Object.entries(s)
    .filter(([, it]) => it.due <= now)
    .sort((a, b) => a[1].due - b[1].due)
    .map(([k]) => k);
}

/** "şimdi", "12 dk sonra", "3 gün sonra" gibi. */
export function dueLabel(due: number, now: number): string {
  const d = due - now;
  if (d <= 0) return 'şimdi';
  if (d < 60 * MIN) return `${Math.ceil(d / MIN)} dk sonra`;
  if (d < DAY) return `${Math.ceil(d / (60 * MIN))} saat sonra`;
  return `${Math.round(d / DAY)} gün sonra`;
}

export function validReviewState(x: unknown): x is ReviewState {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  return Object.values(x).every(
    (it) =>
      typeof it === 'object' &&
      it !== null &&
      Number.isInteger(it.box) &&
      it.box >= 0 &&
      it.box <= MAX_BOX &&
      [it.due, it.seen, it.correct, it.last].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) &&
      it.correct <= it.seen,
  );
}
