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
- **Sci-Fi Essentials Kit (Standard):** `Prop_Crate`, `Prop_Crate_Large`, `Prop_Locker`

Değişiklikler:
- glTF dosyalarındaki doku yolları ortak `textures/` klasörünü gösterecek şekilde yeniden yazıldı
  (iki kitin ortak trim dokuları birebir aynı olduğu için tek kopya tutuluyor).
- `T_Props_Crates_*` dokuları 4096 px'ten 1024 px'e küçültüldü. Trim dokuları orijinal 2048 px.
