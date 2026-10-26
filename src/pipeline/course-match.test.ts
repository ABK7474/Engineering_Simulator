import { describe, expect, it } from 'vitest';
import courses from '../../content/courses.json';
import { classify, matchCourse, topicNameFromFile } from './course-match';

describe('ders klasörü eşleştirme', () => {
  it('ad ya da kimlik; büyük-küçük harf, Türkçe karakter ve ayraç fark etmez', () => {
    expect(matchCourse('Devre Teorisi 1', courses)).toBe('devre-teorisi-1');
    expect(matchCourse('devre_teorisi_1', courses)).toBe('devre-teorisi-1');
    expect(matchCourse('OLASILIK VE İSTATİSTİK', courses)).toBe('olasilik-istatistik');
    expect(matchCourse('Olasilik ve Istatistik', courses)).toBe('olasilik-istatistik');
    expect(matchCourse('İleri Programlama (C#)', courses)).toBe('ileri-programlama');
    expect(matchCourse('Kimya', courses)).toBeNull();
  });

  it('alt klasörler: notlar/konular, sorular/ornek_sorular, kitaplar ve bölümleri', () => {
    expect(classify('Devre Teorisi 1/Konular/a.pdf', courses)).toMatchObject({ courseId: 'devre-teorisi-1', kind: 'notes', fromBook: false });
    expect(classify('Devre Teorisi 1/notlar/a.PDF', courses)?.kind).toBe('notes');
    expect(classify('Devre Teorisi 1/Ornek_Sorular/vize.png', courses)?.kind).toBe('questions');
    expect(classify('Devre Teorisi 1/Örnek Sorular/vize.pdf', courses)?.kind).toBe('questions');
    expect(classify('Devre Teorisi 1/kitaplar/irwin.pdf', courses)).toMatchObject({ kind: 'book', fromBook: true });
    expect(classify('Devre Teorisi 1/kitaplar/irwin/03-ch1.pdf', courses)).toMatchObject({ kind: 'notes', fromBook: true });
    expect(classify('Kimya/notlar/a.pdf', courses)).toMatchObject({ courseId: null, courseDir: 'Kimya' });
  });

  it('düzen dışı ve desteklenmeyenler atlanır', () => {
    expect(classify('Devre Teorisi 1/a.pdf', courses)).toBeNull();
    expect(classify('Devre Teorisi 1/notlar/a.docx', courses)).toBeNull();
    expect(classify('Devre Teorisi 1/notlar/alt/a.pdf', courses)).toBeNull();
    expect(classify('Devre Teorisi 1/kitaplar/irwin/_bolumler.json', courses)).toBeNull();
    expect(classify('Devre Teorisi 1/notlar/.~kilit.pdf', courses)).toBeNull();
    expect(classify('Devre Teorisi 1/diger/a.pdf', courses)).toBeNull();
  });

  it('konu adı dosya adından', () => {
    expect(topicNameFromFile('Devre/notlar/thevenin_ve-norton.pdf')).toBe('Thevenin ve norton');
  });
});
