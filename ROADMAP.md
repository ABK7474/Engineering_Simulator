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
- [x] Sonraki odalarda (2c): çanak dış sahnede (sensör odası penceresinin karşısında, kodla üretilmiş, tarar, fener yanıp söner); dört yeni oda ekran görüntüsüyle kontrol edildi, konsol temiz
- [x] Deniz canlıları `src/hub/sealife.ts`: 6 balık sürüsü (156 balık, her odanın penceresinin önünde), 18 kendinden ışıklı denizanası, kaya ve çanağa değmeyen yosun kümeleri, yanıp sönen biyolüminesan plankton, çatıların üstünden geçen uzak vatoz silüeti. Yaratık yaklaşınca sürü dağılıp kaçar, plankton parlar; tehdit sürerken sürüler tedirgin. Her tür tek çizim çağrısı; en kötü bakış 109 çağrı / 115 bin üçgen

## Adım 2 — Dersler ve oyun (değer sırasıyla)
### 2a. Kalan devre/elektronik, DiffEq, Müh. Mat., Olasılık
- [x] Diyot (Shockley; Newton + ikiye bölme), RC/RL filtre kesimi (kapalı form + karmaşık empedans), süperpozisyon (MNA doğrusallık + kapalı form). Kartlar: generator-sync-01 (süperpozisyon + diyot, güç odası için), sonar-frontend-01 (filtre, sensör odası için) — odalara 2c'de yerleşecek
- [x] RLC sönüm tasarımı (damping: kapalı form ζ + RK4 aşma/oturma ölçümü). Kart: outer-door-01 aşama 1
- [x] Kararlılık (stability: 2×2 özdeğer kapalı form + benzetimle sönme hızı), Laplace (son değer + başlangıç eğimi, durum uzayı RK4 teyidi), karmaşık sayı/fazör (karmaşık toplam + örnekleme). Kartlar: outer-door-01 aşama 2–3, sonar-frontend-01 aşama 2
- [x] Bayes (BigInt kesin kesir + Monte Carlo), binom ve Poisson yedeklilik (kesin/seri + gama integrali + Monte Carlo). Kart: bilge-pumps-01 (iki aşama). Yeni sonuçlar: false_alarm, leak_ignored, redundancy_lost, power_waste (denge satırı + hub efekti)
- [x] İçerik testi: content/faults altındaki bütün kartlar doğrulanır ve 5 tohumda üretilir (src/puzzles/cards.test.ts)
- Not: generator-sync-01, sonar-frontend-01, outer-door-01, bilge-pumps-01 henüz dünyada değil; odalarına 2c'de yerleşecek
### 2b. Veri yapıları + C#
- [x] Ağaç, BFS/DFS, sıralama: yeni `algo-trace` türü (BFS, özyinelemeli DFS, ekleme ve seçme sıralaması, BST ekleme yolu + pre/postorder). Bağımsız ikinci uygulama + tek onarım noktası; gösterilen C# kodu `npm run verify:algo` ile gerçek dotnet'te 200/200 tohum birebir. Kart: ai-core-index-01 (3 aşama)
- [x] C# çıktı tahmini: `cs-output` türü, 10 elle yazılmış şablon (struct kopyası, virtual/new, kapanış, finally, string, static, ref, LINQ ertelenmesi, yield, kısa devre), yanılgı yamaları. `npm run gen:cs` → content/generated/cs-output.json (dotnet 10, 160 örnek). Kart: ai-core-runtime-01 (2 aşama)
- Not: ai-core-index-01 ve ai-core-runtime-01 odalarına 2c'de (AI çekirdeği K-1) yerleşecek
### 2c. Yeni odalar ve zincirler
- [x] Dört yeni oda: güç P-1 (generator-sync), sensör S-1 (sonar-frontend), AI çekirdeği K-1 (ai-core-index → ai-core-runtime), hava kilidi A-1 (bilge-pumps → outer-door). Her odada pencere
- [x] Disiplinler arası zincirler: yedek güç → P-1 jeneratör (Devre) → S-1 sonar (Elektronik + Müh. Mat.; ana bara ve jeneratör ister) → K-1 (Veri Yapıları → C#); C-1 valf → A-1 sintine (Olasılık) → dış kapı (DiffEq + Müh. Mat.)
- [x] Zorluk odadan odaya: oda binSize/tolerance yeni türlere de uygulanır; fazör ve algo için oda ayarları (S-1 sıkı fazör toleransı, K-1 büyük graf/ağaç). 20 tohumda doğrulanır
- [x] NEREUS replikleri: yeni odalara giriş, çözüm ve engel satırları
### 2d. Tehdit olayı
- [x] Tehdit durum makinesi (core/threat.ts, saf + testli): sonar kalibre edildikten 25 sn sonra başlar; sayaç yalnız dolaşırken işler; koşmak 2,5 kat hızlandırır; süre dolunca saldırı (kaynak kaybı), 120 sn sonra yeniden gelir; HUD'da TEMAS sayacı ve gürültü göstergesi
- [x] Karartma panosu (blackout-01, S-1; yalnız tehdit sürerken açılır): sonar teması Bayes (olasılık türüne "contact" teması) → yeni `light-decay` türü (süperkapasitör deşarjı, iki şart, RK4 teyidi, 1000 tohum)
- [x] Yeni sonuçlar: creature_alerted, dark_stumble, creature_strike (denge + hub efekti: kükreme, ışık titremesi, pencere önünden geçen gölge)
- [x] Tarayıcıda denendi: olay başlar, `threat.active` eklenir, pano açılır, konsol temiz
### 2e. Kalıcı sistemler
- [x] Aralıklı tekrar (core/review.ts, Leitner; testli): her denemede konu kaydı; HUD'da "Tekrar zamanı: n konu"; Defter → Tekrar sekmesinde ücretsiz pratik
- [x] Defter (N ya da ⋯ menüsü): formül sayfaları (denenen konuların brifingleri), 9 istasyon kaydı (content/story/logs.json, durumlarla açılır), konu adları (content/topics.json; her etiketin adı testle zorunlu)
- [x] İpucu sistemi: 18 türün hepsinde iki kademe (yöntem + hesaplanmış ara değer), her biri güç −3; içerik testi her aşamada ipucu olduğunu denetler
- [x] Sezon 1 finali: bütün arızalar onarılınca NEREUS'un açıklaması ve sezon özeti; tarayıcıda denendi

## Oturum günlüğü
(her oturumun sonunda kısa not: ne bitti, ne yarım kaldı, ilk yapılacak şey)
- 2026-10-22 · Adım 0 ve 1 bitti. Sıradaki: 2a (diyot, filtre, süperpozisyon, RLC, Müh. Mat., olasılık türleri).
- 2026-10-22 · 2a bitti (9 yeni tür, 368+ test). Sıradaki: 2b (ağaç/BFS/DFS/sıralama trace, C# çıktı tahmini).
- 2026-10-22 · 2b bitti (algo-trace, cs-output; 401 test). Sıradaki: 2c (yeni odalar: güç P-1, hava kilidi A-1, sensör S-1, AI çekirdeği K-1; kartları yerleştir, zincirler, pencereler/dış sahne).
- 2026-10-22 · 2c bitti (6 oda, 402 test). Sıradaki: 2d tehdit olayı.
- 2026-10-22 · 2d bitti (416 test). Sıradaki: 2e (aralıklı tekrar, kayıtlar/formül defteri, ipucu, Sezon 1 finali).
- 2026-10-22 · 2e bitti (425 test). Adım 2'nin tamamı bitti. Kalan: kullanıcının isteyeceği tarayıcı e2e turu ve `npm run verify:cs` / `verify:algo` (yavaş testler).

## Doğrulama turu (2026-10-22)
- [x] `npm run verify:cs` 100/100; yeni `npm run e2e` (başsız Chrome): koridordan finale 12 arıza, W ile kapıdan yürüme, tehdit olayı, konsol temiz
- [x] Düğümde baştan sona oynanış testi (kapalı kapılarla yürünebilirlik): core-index koşul hatası bulundu, düzeltildi
- [x] Her aşamada çözücünün cevabı başarı veriyor (12 kart × 20 tohum)
- [x] Harita aynalıydı (ileri/geri ve sağ/sol ters) → eksenler 3B görüntüyle eşlendi; oda etiketleri komşu odanın altında kalmıyor
- [x] Kapı animasyonu sonuç efektleriyle siliniyordu, kapı yarı açık kalıyordu → ayrı zamanlayıcı
- [x] Görsel inceleme: yana kayan kapı kanadı, tabela atlası (emissive), okunmayan terminal ekranı, belirlenimci olmayan giydirme (tarayıcı ≠ düğüm), sensör odasında süs yok → düzeltildi
- [x] Çizim bütçesi (≤150 çağrı, ≤150k üçgen): BatchedMesh, tek parça kapı kanadı, daha az ağır dekor → bütün görüntüler bütçede
- [x] HANDCHECK.md: 13 el hesabı, src/handcheck.test.ts ile çözücülerle karşılaştırıldı; uyuşmazlık yok
- [x] Son `npm run e2e` (bütün düzeltmelerden sonra): 12 arıza → final, bütün kapılar tam açık, 13 görüntünün hepsi bütçede (en fazla 106 çağrı / 100 bin üçgen), konsol temiz (31,3 dk)
- [x] Kullanıcının bildirdiği iç içe geçme/havada durma: duvar dekoru gerçek (yatık) duvar yüzeyine, pilaster ve ortak duvar kuralları, zemin/tavan çakışmaları, elle konmuş kablolar; GLB kutularıyla genel tarama testi (`intersect.test.ts`) sıfır çakışma
- [x] `npm run screens` (hızlı görsel kontrol, ~10 dk) eklendi

