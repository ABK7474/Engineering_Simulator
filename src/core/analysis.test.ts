import { describe, expect, it } from 'vitest';
import { analysisMarkdown, buildCourseAnalysis, mergeAnalyses, parseCourseAnalysis, validateFileAnalysis } from './analysis';

const vize = {
  questionCount: 4,
  topics: [
    { name: 'Thevenin', weight: 3 },
    { name: 'Düğüm analizi', weight: 1 },
  ],
  steps: { min: 2, typical: 4, max: 7 },
  traps: ['Bağımlı kaynağı kısa devre yapmak', 'İşaret yönü'],
  ranges: [{ quantity: 'Direnç', unit: 'Ω', min: 100, max: 4700 }],
  notation: [{ symbol: 'V_x', meaning: 'kontrol gerilimi' }],
  patterns: [
    { name: 'Bağımlı kaynaklı Thevenin', description: 'x', count: 3, steps: 5, coveredBy: 'thevenin', fit: 'partial' },
    { name: 'Süper düğüm', description: 'y', count: 1, steps: 4, coveredBy: null, fit: 'none' },
  ],
  proposals: [{ name: 'Bağımlı kaynak türü', kind: 'new-type', description: 'z', covers: ['Bağımlı kaynaklı Thevenin'], priority: 2 }],
};
const final = {
  questionCount: 2,
  topics: [{ name: 'thevenin', weight: 100 }],
  steps: { min: 3, typical: 6, max: 9 },
  traps: ['bağımlı kaynağı  kısa devre yapmak'],
  ranges: [{ quantity: 'direnç', unit: 'Ω', min: 10, max: 1000 }],
  notation: [{ symbol: 'V_x', meaning: 'kontrol gerilimi' }],
  patterns: [{ name: 'Süper Düğüm', description: 'y', count: 2, steps: 6, coveredBy: 'bilinmeyen-tur', fit: 'full' }],
  proposals: [
    { name: 'Süper düğüm biçimi', kind: 'variant', description: 'w', covers: ['süper düğüm'], priority: 1 },
    { name: 'bağımlı kaynak türü', kind: 'new-type', description: 'z', covers: ['Süper düğüm'], priority: 4 },
  ],
};

describe('soru analizi', () => {
  it('doğrulama: bilinmeyen tür kimliği düşer (uyum "yok"), ağırlıklar yüzdeye, bozuk girdiler atılır', () => {
    const f = validateFileAnalysis({ ...final, ranges: [...final.ranges, { quantity: 'x', min: 'a', max: 2 }], traps: [...final.traps, 42] })!;
    expect(f.patterns[0]).toMatchObject({ coveredBy: null, fit: 'none' });
    expect(f.topics).toEqual([{ name: 'thevenin', weight: 100 }]);
    expect(f.ranges).toHaveLength(1);
    expect(f.traps).toHaveLength(1);
    expect(validateFileAnalysis({ patterns: [] })).toBeNull();
    expect(validateFileAnalysis('metin')).toBeNull();
    // Soru sayısı kalıplardan az bildirilirse kalıp toplamı esas
    expect(validateFileAnalysis({ ...vize, questionCount: 1 })!.questionCount).toBe(4);
  });

  it('birleştirme kodla: soru sayısıyla ağırlık, adla kalıp/öneri birleşimi, karşılanmayan yüke göre sıra', () => {
    const m = mergeAnalyses([validateFileAnalysis(vize)!, validateFileAnalysis(final)!]);
    expect(m.questionCount).toBe(6);
    // Thevenin: 0,75·4 + 1·2 = 5 / 6
    expect(m.topics[0]).toEqual({ name: 'Thevenin', weight: 83.3 });
    expect(m.steps).toEqual({ min: 2, typical: 5, max: 9 });
    expect(m.traps[0]).toEqual({ text: 'Bağımlı kaynağı kısa devre yapmak', files: 2 });
    expect(m.ranges).toEqual([{ quantity: 'Direnç', unit: 'Ω', min: 10, max: 4700, files: 2 }]);
    const sd = m.patterns.find((p) => p.name === 'Süper düğüm')!;
    expect(sd).toMatchObject({ count: 3, fit: 'none', coveredBy: null, files: 2, steps: 5 });
    expect(m.coverage).toEqual({ full: 0, partial: 3, none: 3 });
    // "Bağımlı kaynak türü": Thevenin kısmen (3·0,5) + süper düğüm (3·1) = 4,5 → ilk sırada
    expect(m.recommendations.map((r) => [r.rank, r.name, r.uncovered])).toEqual([
      [1, 'Bağımlı kaynak türü', 4.5],
      [2, 'Süper düğüm biçimi', 3],
    ]);
    expect(m.recommendations[0]).toMatchObject({ priority: 3, files: 2 });
  });

  it('kayıttan okuma birleşimi yeniden hesaplar; .md okunur ve tablo hücresi kaçışlı', () => {
    const files = [
      { path: 'D/sorular/vize.pdf', sha256: 'a', analysis: validateFileAnalysis({ ...vize, patterns: [{ ...vize.patterns[0], name: 'A | B' }] })! },
      { path: 'D/sorular/final.pdf', sha256: 'b', analysis: validateFileAnalysis(final)! },
    ];
    const a = buildCourseAnalysis({ id: 'devre-teorisi-1', name: 'Devre Teorisi 1' }, files, 'mock', new Date('2026-10-26'));
    const back = parseCourseAnalysis(JSON.parse(JSON.stringify({ ...a, merged: { bozuk: true } })))!;
    expect(back.merged).toEqual(a.merged);
    expect(back.files.map((f) => f.path)).toEqual(['D/sorular/final.pdf', 'D/sorular/vize.pdf']);
    const md = analysisMarkdown(a);
    expect(md).toContain('# Ders analizi: Devre Teorisi 1');
    expect(md).toContain('1. **Süper düğüm biçimi** (soru biçimi)');
    expect(md).toContain('- thevenin: %83,3');
    expect(md).toContain('A \\| B');
  });
});
