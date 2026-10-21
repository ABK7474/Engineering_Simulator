import { describe, expect, it } from 'vitest';
import { dueLabel, dueTopics, INTERVALS_MS, recordReview, topicKey, validReviewState } from './review';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const K = topicKey('olasilik-istatistik', 'bayes-teoremi');

describe('aralıklı tekrar', () => {
  it('ilk doğru: kutu 1, ertesi gün; sonraki doğrular 3, 7, 14, 30 gün; kutu 5\'te kalır', () => {
    let s = recordReview({}, K, true, T0);
    expect(s[K]).toEqual({ box: 1, due: T0 + DAY, seen: 1, correct: 1, last: T0 });
    const days = [3, 7, 14, 30, 30];
    for (const d of days) {
      s = recordReview(s, K, true, T0);
      expect(s[K].due - T0).toBe(d * DAY);
    }
    expect(s[K].box).toBe(5);
  });

  it('yanlış cevap kutuyu sıfırlar, konu 10 dk sonra yeniden gelir', () => {
    let s = recordReview({}, K, true, T0);
    s = recordReview(s, K, true, T0);
    s = recordReview(s, K, false, T0);
    expect(s[K]).toMatchObject({ box: 0, due: T0 + 10 * 60_000, seen: 3, correct: 2 });
    expect(INTERVALS_MS[0]).toBe(600_000);
  });

  it('zamanı gelenler en gecikmiş önce sıralanır', () => {
    let s = recordReview({}, 'a/x', true, T0); // T0 + 1 gün
    s = recordReview(s, 'b/y', false, T0); // T0 + 10 dk
    s = recordReview(s, 'c/z', true, T0 + DAY); // T0 + 2 gün
    expect(dueTopics(s, T0)).toEqual([]);
    expect(dueTopics(s, T0 + DAY)).toEqual(['b/y', 'a/x']);
  });

  it('etiketler ve doğrulama', () => {
    expect(dueLabel(T0, T0)).toBe('şimdi');
    expect(dueLabel(T0 + 12 * 60_000, T0)).toBe('12 dk sonra');
    expect(dueLabel(T0 + 3 * DAY, T0)).toBe('3 gün sonra');
    expect(validReviewState(recordReview({}, K, true, T0))).toBe(true);
    expect(validReviewState({ x: { box: 9, due: 0, seen: 0, correct: 0, last: 0 } })).toBe(false);
    expect(validReviewState({ x: { box: 1, due: 0, seen: 1, correct: 2, last: 0 } })).toBe(false);
  });
});
