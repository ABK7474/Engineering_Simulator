# Emeği Geçenler / Credits

Oyunda kullanılan üçüncü taraf varlıklar. Ham (orijinal) dosyalar repoda değil,
`~/oyun-kaynak-assetler/` altında durur; burada yalnızca oyunun kullandığı, gerekirse
dönüştürülmüş/küçültülmüş kopyalar listelenir.

## Müzik — `public/assets/audio/music/`

| Dosya | Eser | Yazar | Lisans | Not |
|---|---|---|---|---|
| `hub/underwater-theme-ii.ogg` | Underwater Theme II | Cleyton Kauffman — https://soundcloud.com/cleytonkauffman | CC0 | FLAC kaynaktan OGG Vorbis'e dönüştürüldü (q4, stereo) |
| `hub/underwater-theme-2nd-variation.ogg` | underwater theme 2nd variation | Spring Spring — https://opengameart.org/node/77344 | CC0 | Orijinal OGG, değiştirilmedi |
| `hub/submerge-coral-reef.ogg` | coral reef (SUBMERGE) | SUBMERGE - Music by Magnality, https://magnality.carrd.co | Atıf gerekli | WAV kaynaktan OGG Vorbis'e dönüştürüldü (q4, stereo) |
| `tension/insistent.ogg` | Insistent | yd | CC0 | Orijinal OGG, değiştirilmedi |
| `tension/searching.ogg` | Searching | yd | CC0 | Orijinal OGG, değiştirilmedi |

## Ses efektleri — `public/assets/audio/sfx/`

Tümü Kenney (www.kenney.nl), **CC0**. Her paketin `License.txt` dosyası kendi klasöründedir.
Dosyalar değiştirilmeden kopyalandı.

| Klasör | Paket | Dosyalar | Kullanım |
|---|---|---|---|
| `kenney_sci-fi-sounds/` | Sci-Fi Sounds 1.0 | `doorOpen_000–002`, `doorClose_000–002` | Kapı |
| | | `lowFrequency_explosion_001` | Sigorta atması |
| | | `slime_001` | Su sızıntısı — **GEÇİCİ**, gerçek bir su sesiyle değiştirilecek |
| `kenney_interface-sounds/` | Interface Sounds | `click_001`, `click_002`, `switch_002` | Panel tıklaması |
| | | `glitch_001–004` | Kıvılcım çıtırtısı |
| `kenney_impact-sounds/` | Impact Sounds | `footstep_concrete_000–004` | Adım |
| | | `impactGlass_light_000` | LED patlaması |
| | | `impactMetal_heavy_001` | Takılan kapı |

### İstasyon sesleri — `public/assets/audio/sfx/station/`

OpenGameArt kaynaklı, hepsi **CC0**. `scripts/import-assets.mjs` ile mono OGG Vorbis'e (q3) çevrildi;
gerektiğinde kırpıldı ve filtrelendi (aşağıda). Ham dosyalar `~/oyun-kaynak-assetler/sesler/` altında,
her klasörde kaynağı yazan `KAYNAK.txt` var.

| Dosya | Eser | Yazar | Kaynak | Değişiklik | Kullanım |
|---|---|---|---|---|---|
| `steam_1/2/3.ogg` | Steam release sounds | bart | https://opengameart.org/content/steam-release-sounds | WAV → OGG | Buhar püskürmesi |
| `gas_leak.ogg` | Compressed Gas Leak SFX | 0new4y | https://opengameart.org/content/compressed-gas-leak-sfx | — | Gaz kaçağı döngüsü |
| `drip_loop.ogg`, `bubbles_loop.ogg`, `splash_1.ogg` | 40 CC0 water / splash / slime SFX | rubberduck | https://opengameart.org/node/60416 | — | Damla/su döngüsü |
| `sonar_ping.ogg` | sonar ping | Spiceman | https://opengameart.org/content/sonar-ping | MP3 → OGG | Sonar |
| `creature_roar.ogg` | CC0 Deep Monster Roar | trazzz123 | https://opengameart.org/content/cc0-deep-monster-roar | alçak geçiren 900 Hz, son 1,2 s sönüm | Uzak yaratık |
| `creature_rumble.ogg` | Rumbling Sound Effects (rumbling17) | bretbernhoft | https://opengameart.org/content/rumbling-sound-effects | 20–28 s arası, alçak geçiren 260 Hz, giriş/çıkış sönümü | Uzak gümbürtü |

Alarm sesi dosya değildir; oyun içinde Web Audio ile üretilir.

## PBR dokular — `public/assets/textures/`

Poly Haven (https://polyhaven.com), **CC0**. 1k JPG; diffuse, normal (OpenGL) ve ARM
(AO/pürüzlülük/metaliklik) dokuları değiştirilmeden kopyalandı.

| Klasör | Doku | Kaynak | Kullanım |
|---|---|---|---|
| `metal_plate_02/` | Metal Plate 02 | https://polyhaven.com/a/metal_plate_02 | Koridor zemini |
| `rusty_metal_04/` | Rusty Metal 04 | https://polyhaven.com/a/rusty_metal_04 | Kapı kanatları (kutu izdüşümü UV ile) |

## 3D modeller ve dokular — `public/assets/models/quaternius/`

Tümü Quaternius (https://quaternius.com), **CC0**. Lisans metinleri:
`LICENSE-quaternius-modular-scifi-megakit.txt`, `LICENSE-quaternius-scifi-essentials-kit.txt`.

- **Modular SciFi MegaKit (Standard):** `WallAstra_Straight`, `WallAstra_Straight_Window`,
  `WallAstra_Straight_Broken`, `TopCables_Straight`, `TopCables_Straight_Hanging`,
  `BottomMetal_Straight`, `Platform_DarkPlates`, `Platform_CenterPlate`, `Door_Frame_Square`,
  `Door_Metal`, `Prop_AccessPoint`, `Prop_Light_Wide`, `Prop_Light_Small`, `Prop_Vent_Wide`,
  `Prop_Cable_1`, `Column_Simple`, `Prop_Computer` (kontrol odası konsolu)
  Oda giydirmesi için eklenenler: `Prop_Fan_Small`, `Prop_Vent_Small`, `Prop_Vent_Big`, `Prop_Barrel_Large`,
  `Prop_Cable_3`, `Prop_Clamp`, `Prop_ItemHolder`, `Prop_Light_Floor`, `Prop_Chest`, `Prop_Crate3`,
  `Prop_Crate4`, `Prop_PipeHolder`, `Column_Pipes`, `Column_Hollow`, `Column_Round`
- **Sci-Fi Essentials Kit (Standard):** `Prop_Crate`, `Prop_Crate_Large`, `Prop_Locker`, `Prop_Desk_L`,
  `Prop_Desk_Medium`, `Prop_Desk_Small`, `Prop_Chair`, `Prop_Shelves_WideTall`, `Prop_Shelves_WideShort`,
  `Prop_Barrel1`, `Prop_Barrel2_Closed`, `Prop_SatelliteDish`, `Prop_Crate_Tarp`

Değişiklikler:
- glTF dosyalarındaki doku yolları ortak `textures/` klasörünü gösterecek şekilde yeniden yazıldı
  (iki kitin ortak trim dokuları birebir aynı olduğu için tek kopya tutuluyor).
- `T_Props_Crates_*` dokuları 4096 px'ten 1024 px'e küçültüldü. Trim dokuları orijinal 2048 px.
- `T_PaddedWall_*` dokuları 2048 px'ten 1024 px'e küçültüldü (boyut bütçesi). `Prop_Fan_Small`'ın
  `T_Trim_01_BaseColor` dokusu, ayrıca 1 MB yüklememek için aynı trim'in kırmızı varyantına bağlandı.
- Aynı PNG'yi kullanan modeller oyunda tek doku nesnesi paylaşır (`shareTextures`).

## 3D modeller — `public/assets/models/umsf/`

**Ultimate Modular Sci-Fi (Feb 2021)**, Quaternius (https://quaternius.com), **CC0**. Duvar süsleri:
`Details_Pipes_Long`, `Details_Pipes_Medium`, `Details_Cylinder`, `Details_Cylinder_Long`, `Details_Vent_1`,
`Details_Vent_3`, `Details_Output`, `Details_Output_Small`, `Details_Plate_Large`, `Details_Plate_Details`,
`Details_Hexagon`, `Details_Triangles`. Paket yalnız FBX/OBJ/Blend; OBJ sürümü assimp ile GLB'ye çevrildi
(FBX çevirisi santimetre ölçek ve Z-yukarı eksenle bozuk çıktığı için kullanılmadı).

## Kodla üretilen görseller

Kir/pas/damlama/su lekesi atlası, tabelalar, ekran içerikleri ve parçacık sprite'ı oyun açılırken canvas ile
üretilir (`src/hub/procedural.ts`); dış varlık değildir.
