// Push öncesi boyut denetimi (`npm run check:size`): repoda izlenen ve eklenecek (ignore edilmemiş) her dosya taranır.
// GitHub tek dosyada 100 MB'ı reddeder: böyle dosya varsa çıkış kodu 1 (push edilmez). 50 MB üstü uyarı.
// ders_materyalleri/'nden repoya girecek dosyalar ayrıca listelenir (kitaplar/ git dışında kalır).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const LIMIT = 100 * 1024 * 1024;
const WARN = 50 * 1024 * 1024;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
const files = [...new Set([...git('ls-files', '-z'), ...git('ls-files', '-z', '--others', '--exclude-standard')])].filter((f) => fs.existsSync(f));
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const sized = files.map((f) => ({ f, size: fs.statSync(f).size })).sort((a, b) => b.size - a.size);
const over = sized.filter((x) => x.size > LIMIT);
const warn = sized.filter((x) => x.size > WARN && x.size <= LIMIT);
const materials = sized.filter((x) => x.f.startsWith('ders_materyalleri/'));
const total = sized.reduce((a, x) => a + x.size, 0);

console.log(`${sized.length} dosya, toplam ${mb(total)}; en büyük: ${sized[0] ? `${sized[0].f} (${mb(sized[0].size)})` : '—'}`);
if (materials.length) console.log(`ders_materyalleri/ → repoya girecek ${materials.length} dosya, ${mb(materials.reduce((a, x) => a + x.size, 0))}`);
for (const x of warn) console.warn(`UYARI: ${x.f} ${mb(x.size)} (50 MB üstü; GitHub uyarır)`);
if (over.length) {
  for (const x of over) console.error(`HATA: ${x.f} ${mb(x.size)} — GitHub'ın 100 MB dosya sınırını aşıyor. Push etme.`);
  process.exit(1);
}
console.log('Boyut denetimi tamam: 100 MB üstü dosya yok.');
