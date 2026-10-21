# Yol haritası — Sezon 1'i baştan sona oynanabilir yapmak

Bu dosya oturumlar arası devamlılık içindir: her bölüm bitince işaretlenir, yarım kalan iş ve nedeni yazılır.
Kurallar: her bölüm sonunda `npx tsc --noEmit`, `npm test`, `npm run build`; geçerse commit + push, geçmezse push yok
ve neden buraya yazılır. Belirsiz kararlar DECISIONS.md'de, eksik varlıklar ASSETS_NEEDED.md'de.

Durum işaretleri: `[x]` bitti · `[~]` sürüyor/kısmen · `[ ]` başlanmadı

## Önceki oturumlardan hazır olanlar
- [x] Koridor + kontrol odası, kapı, harita, oda girişinden yeniden başlama, NEREUS replikleri
- [x] Türler: series-led, series-parallel, ds-trace (yığın/kuyruk/liste), thevenin, max-power, opamp, rc-rl
- [x] Ders/konu etiketleri (course/topic), içerik hattı (Gemini, mock), verify:cs (dotnet)

## Adım 0 — Asset yerleşimi
- [x] Ham klasörleri ve olası yanlış yerleri tara (İndirilenler, Masaüstü, proje, public/assets)
- [x] Yanlış yerdekileri ~/oyun-kaynak-assetler/{modeller,sesler,muzik}/<paket>/ altına taşı (silme yok); her tek dosyalık pakete KAYNAK.txt
- [x] public/assets yalnız oyunun kullandığı küçük küme (36 → 43 MB, yeni prop/ses dahil)
- [x] Belirsiz lisans (IndustrialPack) → ASSETS_NEEDED.md, kullanılmıyor

## Adım 1 — Görsel zenginleştirme
- [x] Paket envanteri; 27 Quaternius prop'u + 12 Ultimate Modular duvar süsü (`scripts/import-assets.mjs`)
- [x] OBJ → GLB (assimp; FBX çevirisi bozuk olduğu için OBJ)
- [x] Tek model kataloğu `src/world/catalog.ts` (çarpışma kutusu, yükseklik)
- [x] Oda temaları `content/world/themes.json` (corridor, control, power, airlock, sensor, core) + deterministik giydirme `src/world/dressing.ts`; zorunlu setler oda karakterini garanti eder
- [x] Yürünebilirlik `src/world/walk.ts` (doğrulayıcıda da): terminal önü, giriş, kapılar erişilebilir
- [x] Kodla yüzey bozulması (pas, damlama, su lekesi, kurum atlası), zemin birikintileri, tabelalar (kapı üstü oda adı + uyarı levhaları)
- [x] Animasyonlu ekranlar (dalga, grafik, kayıt metni), buhar/gaz/damla parçacıkları, titreyen lambalar
- [x] Işık havuzu: 6 soğuk + 2 sıcak (ekran) ışık, kameraya en yakın noktalara; sayı sabit (shader derlenmez)
- [x] Sesler: buhar püskürmesi, gaz kaçağı ve damla döngüleri (mesafeye göre), uzak yaratık gümbürtüsü/kükremesi (ışık titrer), ana bara beslenince sonar ping
- [x] Performans: doku tekilleştirme (148 → 37 doku), oda başına statik gruplar, kapalı kapının arkası çizilmez, uzak düzlem 34 m. Başlangıç bakışı: önce 73 çağrı / 73,5 bin üçgen → sonra 104 çağrı / 86 bin üçgen
- [x] ASSETS_NEEDED.md, CREDITS.md, DECISIONS.md güncel
- [ ] Sonraki odalarda (2c): uydu çanağı dış sahneye (sensör odası), yeni temaların ekran görüntüsüyle kontrolü

## Adım 2 — Dersler ve oyun (değer sırasıyla)
### 2a. Kalan devre/elektronik, DiffEq, Müh. Mat., Olasılık
- [x] Diyot (Shockley; Newton + ikiye bölme), RC/RL filtre kesimi (kapalı form + karmaşık empedans), süperpozisyon (MNA doğrusallık + kapalı form). Kartlar: generator-sync-01 (süperpozisyon + diyot, güç odası için), sonar-frontend-01 (filtre, sensör odası için) — odalara 2c'de yerleşecek
- [x] RLC sönüm tasarımı (damping: kapalı form ζ + RK4 aşma/oturma ölçümü). Kart: outer-door-01 aşama 1
- [x] Kararlılık (stability: 2×2 özdeğer kapalı form + benzetimle sönme hızı), Laplace (son değer + başlangıç eğimi, durum uzayı RK4 teyidi), karmaşık sayı/fazör (karmaşık toplam + örnekleme). Kartlar: outer-door-01 aşama 2–3, sonar-frontend-01 aşama 2
- [x] Bayes (BigInt kesin kesir + Monte Carlo), binom ve Poisson yedeklilik (kesin/seri + gama integrali + Monte Carlo). Kart: bilge-pumps-01 (iki aşama). Yeni sonuçlar: false_alarm, leak_ignored, redundancy_lost, power_waste (denge satırı + hub efekti)
- [x] İçerik testi: content/faults altındaki bütün kartlar doğrulanır ve 5 tohumda üretilir (src/puzzles/cards.test.ts)
- Not: generator-sync-01, sonar-frontend-01, outer-door-01, bilge-pumps-01 henüz dünyada değil; odalarına 2c'de yerleşecek
### 2b. Veri yapıları + C#
- [ ] Ağaç, BFS/DFS, sıralama (trace altyapısı)
- [ ] C# çıktı tahmini (dotnet ile üretimde bir kez çalıştır → JSON)
### 2c. Yeni odalar ve zincirler
- [ ] Hava kilidi, sensör/sonar, AI çekirdeği odaları; disiplinler arası zincirler; zorluk odadan odaya artar
### 2d. Tehdit olayı
- [ ] Yaratık yaklaşırken ışığı kesme bulmacası (sigorta + acil aydınlatma RC sönümü), sonar Bayes, gürültü seviyesi
### 2e. Kalıcı sistemler
- [ ] Aralıklı tekrar, oyun içi kayıtlar/formül defteri, ipucu sistemi, Sezon 1 finali

## Oturum günlüğü
(her oturumun sonunda kısa not: ne bitti, ne yarım kaldı, ilk yapılacak şey)
- 2026-10-22 · Adım 0 ve 1 bitti. Sıradaki: 2a (diyot, filtre, süperpozisyon, RLC, Müh. Mat., olasılık türleri).
- 2026-10-22 · 2a bitti (9 yeni tür, 368+ test). Sıradaki: 2b (ağaç/BFS/DFS/sıralama trace, C# çıktı tahmini).
