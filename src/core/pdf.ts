// PDF ön denetimi (kütüphanesiz): gerçekten PDF mi, kaç sayfa, boyut sınırları, uzunluk uyarısı.
// Sayfa sayımı yaklaşıktır: "/Type /Page" nesneleri sayılır. Sayfa nesneleri sıkıştırılmış nesne
// akışlarında (/ObjStm) olabilir; o durumda sayım güvenilmez ve "bilinmiyor" denir.

/** Sağlayıcının belgelenmiş üst sınırları (satır içi PDF). */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 1000;
/** Bu sayfa sayısının üstünde konulara bölmek önerilir. */
export const LONG_PDF_PAGES = 40;
/** Sayfa sayısı bilinmiyorsa uzunluk uyarısı bu boyuta göre verilir. */
export const LONG_PDF_BYTES = 15 * 1024 * 1024;

export interface PdfInfo {
  isPdf: boolean;
  /** null = güvenilir biçimde sayılamadı. */
  pages: number | null;
  bytes: number;
}

export function inspectPdf(bytes: Uint8Array): PdfInfo {
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head !== '%PDF-') return { isPdf: false, pages: null, bytes: bytes.byteLength };
  const text = new TextDecoder('latin1').decode(bytes);
  const count = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  const compressedObjects = text.includes('/ObjStm');
  return { isPdf: true, pages: count > 0 && !compressedObjects ? count : null, bytes: bytes.byteLength };
}

export interface PdfCheck {
  /** Akışı durduran hata (PDF değil, çok büyük). */
  blocking: string | null;
  warnings: string[];
  /** Kullanıcıya gösterilecek sayfa bilgisi. */
  pagesLabel: string;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

export function checkPdf(info: PdfInfo): PdfCheck {
  const pagesLabel = info.pages === null ? 'sayfa sayısı bilinmiyor' : `${info.pages} sayfa`;
  if (!info.isPdf) return { blocking: 'Bu dosya PDF değil.', warnings: [], pagesLabel };
  if (info.bytes > MAX_PDF_BYTES) return { blocking: `PDF ${mb(info.bytes)}; üst sınır ${mb(MAX_PDF_BYTES)}. Konulara bölerek yükle.`, warnings: [], pagesLabel };
  if (info.pages !== null && info.pages > MAX_PDF_PAGES) return { blocking: `PDF ${info.pages} sayfa; üst sınır ${MAX_PDF_PAGES}.`, warnings: [], pagesLabel };
  const long = info.pages !== null ? info.pages > LONG_PDF_PAGES : info.bytes > LONG_PDF_BYTES;
  const warnings = long
    ? [
        `Uzun PDF (${info.pages !== null ? `${info.pages} sayfa` : mb(info.bytes)}). Uzun PDF'i konulara bölmeniz önerilir: ` +
          'yanıt modelin çıktı sınırında kesilebilir ve .md eksik kalabilir.',
      ]
    : [];
  return { blocking: null, warnings, pagesLabel };
}
