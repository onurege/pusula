# Panorama (NORA 4Sight) — Data Dictionary

Univera ERP (`WEITNAUER-DB`) üzerindeki, Panorama/NORA 4Sight dashboard'unun kullandığı tablo ve kolonların referansı.
Şema + tipler **canlı DB'den (INFORMATION_SCHEMA)** doğrulandı; iş anlamı koddaki sorgulardan çıkarıldı.
Satır sayıları Weitnauer prod anlıktır (2026-08-04). Tenant: `wietnauer`.

> **DB read-only** — yalnız SELECT. Bu doküman şema referansıdır, veri içermez.

---

## Kolon adlandırma kuralı (Univera/Logo ERP prefix'leri)
| Prefix | Tip | Anlam |
|---|---|---|
| `LNG…` | int | Sayısal anahtar (KOD/REF) — genelde PK/FK |
| `TXT…` | varchar/nvarchar | Metin (ad, kod, ünvan) |
| `DBL…` | decimal | Parasal / sayısal ölçü (tutar, miktar, litre) |
| `BYT…` | tinyint | Bayrak / tip / durum (0/1 veya enum) |
| `TRH…` | date / datetimeoffset | Tarih |
| `CHR…` | char | Sabit uzunluklu metin |
| `UID…` | uniqueidentifier | GUID |

**Evrensel filtreler (neredeyse her sorguda):**
- `BYTTUR = 0` → **satış** faturası (fatura tipi)
- `BYTDURUM = 0` → **aktif/geçerli** kayıt (fatura onaylı · müşteri aktif · dist aktif)
- `TRHISLEMTARIHI` → fatura tarihi; pencere `DATEADD(day,-N, sqlNow())` (bkz. NOW_MODE notu)

---

## 1) FACT — Satış / Fatura

### `TBLMSDFATURA` — Fatura başlığı · ~168.313 satır · 108 kolon
Tüm ciro/tutar metriklerinin kaynağı. **Parasal alanlar burada (başlık seviyesi).**
| Kolon | Tip | Anlam |
|---|---|---|
| `LNGBELGEKOD` | int | Fatura anahtarı (detay buraya bağlanır) |
| `TRHISLEMTARIHI` | date | **Fatura tarihi** (pencere/dönem bunun üzerinden) |
| `TRHVADETARIHI` | date | Vade tarihi |
| `BYTTUR` | tinyint | Fatura tipi — **0 = satış** |
| `BYTDURUM` | tinyint | **0 = aktif/onaylı** (iptal/taslak dışlanır) |
| `LNGDISTKOD` | int | → `TBLDIST.LNGKOD` (distribütör) |
| `LNGMUSTERIKOD` | int | → `TBLMUSTERI.LNGKOD` (müşteri) |
| `LNGSTKOD` | int | → satış temsilcisi (`TBLSATISTEMSILCISI`) |
| `DBLBRUTTUTAR` | decimal | Brüt tutar (iskonto öncesi) |
| `DBLISKONTOTUTARI` | decimal | İskonto tutarı |
| `DBLKDVTUTARI` | decimal | KDV tutarı |
| `DBLNETTUTAR` | decimal | **Net tutar** (ana ciro metriği) |
| `DBLOTVTUTAR` | decimal | ÖTV tutarı (ÖTV-net görünüm için) |
| `TXTURUNGRUPKOD` | varchar(10) | Başlık düzeyi ürün grubu (nadir) |

### `TBLMSDBELGEDETAY` — Fatura satırı (kalem) · ~454.730 satır · 54 kolon
Ürün-kırılımlı analizin (marka, SKU, **hacim/70cl**) kaynağı. **Join:** `d.LNGFATURAKOD = f.LNGBELGEKOD`.
| Kolon | Tip | Anlam |
|---|---|---|
| `LNGBELGEDETAYKOD` | bigint | Satır PK |
| `LNGFATURAKOD` | int | → `TBLMSDFATURA.LNGBELGEKOD` |
| `LNGURUNKOD` | int | → `TBLURUN.LNGKOD` (ürün) |
| `LNGDISTKOD` | int | Distribütör (denormalize) |
| `DBLMIKTAR` | decimal | **Miktar** (adet) — hacim hesabının çarpanı |
| `DBLBIRIMFIYAT` | decimal | Birim fiyat |
| `DBLNETFIYAT` | decimal | Net birim fiyat |

> **70cl Hacim formülü (md7):** `Hacim = Σ(TBLMSDBELGEDETAY.DBLMIKTAR × TBLURUN.DBLLITRE)`, `DBLLITRE = kapasite_cl / 70` (70CL→1, 75CL→1.071). NOT: Pernod'da `/9` (9LE) kullanılır — tenant-parametrik olmalı.

### `TBLMSDTAHSILAT` — Tahsilat · ~96.258 satır · 73 kolon
Ödeme/tahsilat verisi (risk skoru payment bileşeni MVP'de kullanmıyor).

---

## 2) DIMENSION — Ürün

### `TBLURUN` — Ürün kartı · ~317 satır · 134 kolon
| Kolon | Tip | Anlam |
|---|---|---|
| `LNGKOD` | int | Ürün PK |
| `TXTKOD` | varchar(50) | Ürün kodu |
| `TXTAD` | nvarchar(120) | Ürün adı |
| `DBLLITRE` | decimal | **Hacim çarpanı** (70cl bazı: 70CL=1, 75CL=1.07) |
| `TXTURUNGRUPKOD` | varchar(10) | → `TBLURUNGRUP.TXTKOD` — **Wietnauer'da MARKA** |
| `TXTURUNEKGRUPKOD` | varchar(20) | → ürün ek grubu (Pernod'da marka) |
| `TXTBARKOD1…5` | varchar(17) | Barkodlar |

> **Şema inversiyonu:** Wietnauer marka = `TBLURUNGRUP`; Pernod marka = `TBLURUNEKGRUP`.

### `TBLURUNGRUP` — Ürün grubu (Wietnauer = MARKA) · ~57 satır
`TXTKOD` varchar(10) PK · `TXTAD` nvarchar(60) ad · `TXTKISAAD` · `LNGURUNGRUPID` int.

### `TBLURUNEKSAHA` — Ürün ek saha (hacim/9L değeri) · **~0 satır (BOŞ)**
`LNGURUNREF`→ürün, `LNGEKSAHAKODU`, `TXTEKSAHAACIKLAMA`. **Join:** `ue.LNGURUNREF = u.LNGKOD`.
⚠️ Wietnauer'da boş → hacim `DBLLITRE`'ye düşer (ek-saha override yok).

---

## 3) DIMENSION — Müşteri

### `TBLMUSTERI` — Müşteri kartı · ~39.857 satır · 184 kolon
| Kolon | Tip | Anlam |
|---|---|---|
| `LNGKOD` | int | Müşteri PK |
| `TXTKOD` | varchar(50) | **Müşteri kodu** (harita aramasında kullanılmalı — md9) |
| `TXTUNVAN` | nvarchar(250) | Ünvan |
| `TXTKISAAD` | nvarchar(30) | Kısa ad |
| `LNGDISTKOD` | int | → `TBLDIST.LNGKOD` |
| `TXTGRUPKOD` | varchar(50) | → `TBLMUSTERIGRUP.TXTKOD` (müşteri grubu/tipi) |
| `TXTEKGRUPKOD` | varchar(50) | → `TBLMUSTERIEKGRUP.TXTKOD` (**direct** — md33'ün doğru yolu) |
| `BYTDURUM` | tinyint | **0 = aktif** (md19: harita bunu filtrelemeli) |
| `BYTTIP` | tinyint | Müşteri tipi bayrağı |
| `DBLKOORDINATX` / `DBLKOORDINATY` | decimal | Harita koordinatları |
| `LNGBOLGEKOD` / `LNGILKOD` / `LNGILCEKOD` | int | Bölge/il/ilçe |
| `TXTOZELKOD` | varchar(20) | Özel kod (takip kodu adayı — md9 için DB'de teyit) |

### `TBLMUSTERIGRUP` — Müşteri grubu/tipi · ~10 satır
`TXTKOD` PK · `TXTAD` nvarchar(30).

### `TBLMUSTERIEKGRUP` — Müşteri ek grubu (kanal: BAKKAL/MARKET…) · ~23 satır
`TXTKOD` PK · `TXTAD` nvarchar(30). **Bağ:** `TBLMUSTERI.TXTEKGRUPKOD = TBLMUSTERIEKGRUP.TXTKOD` (direct).

### `TBLSBMUSTERIEKGRUPBAGLANTI` — Müşteri↔ek grup m2m köprüsü · **~0 satır (BOŞ)** 🔴
`LNGMUSTERIKOD`, `LNGGRUPKOD`. ⚠️ **BOŞ** → md33 bug'ının kök sebebi: m2m join hiç satır dönmüyor. **Çözüm: direct link kullan** (yukarıdaki TBLMUSTERI.TXTEKGRUPKOD).

### `TBLMUSTERIEKSAHA` — Müşteri ek saha değerleri · ~39.650 satır
`LNGMUSTERIREF`→müşteri, `LNGEKSAHAKODU`, `TXTEKSAHAACIKLAMA`. Cockpit "Müşteri Tipi" paneli **saha 8** (`LNGEKSAHAKODU=8`) üzerinden çeker.

### `TBLEKSAHASECENEK` — Ek saha seçenek sözlüğü · ~21 satır
`LNGTAKIPKOD`, `LNGKOD`, `TXTACIKLAMA`. Ek saha kodlarının etiketleri (ör. müşteri tipi seçenekleri).

---

## 4) DIMENSION — Distribütör / Bölge

### `TBLDIST` — Distribütör · ~31 satır · 75 kolon
| Kolon | Tip | Anlam |
|---|---|---|
| `LNGKOD` | int | Distribütör PK |
| `TXTKOD` | varchar(20) | Dist kodu |
| `TXTAD` | nvarchar(50) | Dist adı |
| `TXTGRUP` | varchar(10) | → `TBLDISTGRUP.TXTKOD` (**Pernod'da BÖLGE**; Wietnauer'da dist tipi) |
| `TXTEKGRUP` | varchar(10) | → `TBLDISTEKGRUP.TXTKOD` (**Wietnauer'da BÖLGE**) |
| `BYTDURUM` | tinyint | **0 = aktif** (pasif dist filtrelenmeli — md19/md20) |

### `TBLDISTEKGRUP` — Dist ek grubu (Wietnauer = BÖLGE) · ~6 satır
`TXTKOD` varchar(10) PK · `TXTAD` nvarchar(30). **Join:** `dg.TXTKOD = d.TXTEKGRUP`.
Değerler: AKDENİZ, MARMARA, EGE, ANADOLU, GÜNEYDOĞU…

> **Şema inversiyonu:** Wietnauer bölge = `TBLDISTEKGRUP` (TXTEKGRUP); Pernod bölge = `TBLDISTGRUP` (TXTGRUP), Pernod'da `TBLDISTEKGRUP` = dist tipi (DİSTRİBÜTÖR/TALİ BAYİ).

---

## 5) SAHA — Ziyaret / Temsilci

### `TBLPMPZIYARETBASLIK` — Ziyaret başlığı · ~1.658.836 satır · 19 kolon
Saha ziyaret kayıtları (temsilci performansı, drop size).
### `TBLPMPZIYARETDETAY` — Ziyaret detayı · ~2.513.030 satır · 14 kolon
### `TBLPMPZIYARETOZET` — Ziyaret özeti · ~50.912 satır · 30 kolon
### `TBLSATISTEMSILCISI` — Satış temsilcisi · ~261 satır · 54 kolon
`TBLMSDFATURA.LNGSTKOD` buraya bağlanır (temsilci-fatura).
### `TBLPERSONEL` — Personel · ~287 satır · 67 kolon
### `TBLDISTPERSONEL` — Dist-personel bağı · **~0 satır (BOŞ)**

---

## 6) STOK — ⚠️ Weitnauer'da veri kaynağı büyük ölçüde BOŞ
| Tablo | Satır | Not |
|---|---|---|
| `TBLMSDDEPOHAREKET` | ~3.185 | Depo hareketi |
| `TBLENTDEPOSTOKDURUM` | **0** | Anlık stok durumu — boş |
| `TBLSTOKBARDEPOSTOK` | **0** | Barkod-depo stok — boş |
| `TBLDISTGUNLUKSTOK` | **0** | Dist günlük stok — boş |
| `TBLRPAACIKSIPARIS` | **0** | Açık sipariş (yoldaki) — boş |
| `TBLRPABAYITEDARIKSURE` | **0** | Tedarik süresi — boş |

> ⚠️ Stok ekranı (stok-tukenme) için canlı stok tabloları **boş** — stok metriklerinin veri kaynağı Weitnauer'da mevcut değil. (Talep md38-40'tan önce bu netleştirilmeli.)

---

## 7) AUTH / Kullanıcı

### `TBLKULLANICI` — Kullanıcı · ~250 satır · 40 kolon
| Kolon | Tip | Anlam |
|---|---|---|
| `LNGKOD` | int | Kullanıcı PK |
| `TXTKULLANICIISIM` | varchar(20) | Kullanıcı adı (login) |
| `TXTSIFREREFERANS` | varchar(200) | Şifre (şifreli — AES `UNIVERA_PW_KEY`) |
| `TXTADSOYAD` | nvarchar(50) | Ad soyad |
| `TXTMAILADRESI` | nvarchar(100) | E-posta |
| `BYTDURUM` | tinyint | 0 = aktif |
| `BYTTIP` | tinyint | Kullanıcı tipi (merkez tespiti) |
| `BYTSBPANORAMALOGIN` | tinyint | **Panorama login yetkisi** bayrağı |
| `BYTPOWERBI` / `BYTEXCO` | tinyint | Diğer ürün yetkileri |

### `ERCVIEWTBLKULLANICIDIST_DASHBOARD` — View
Kullanıcı → izinli distribütör listesi (`allowedDistKods`). Auth scope bunun üzerinden çözülür.

---

## 8) İlişki haritası (join anahtarları)
```
TBLMSDFATURA (f)
  ├─ f.LNGBELGEKOD    ←─ TBLMSDBELGEDETAY.LNGFATURAKOD   (başlık↔satır)
  ├─ f.LNGMUSTERIKOD  ─→ TBLMUSTERI.LNGKOD
  ├─ f.LNGDISTKOD     ─→ TBLDIST.LNGKOD
  └─ f.LNGSTKOD       ─→ TBLSATISTEMSILCISI

TBLMSDBELGEDETAY (d)
  └─ d.LNGURUNKOD     ─→ TBLURUN.LNGKOD
                          ├─ u.TXTURUNGRUPKOD  ─→ TBLURUNGRUP.TXTKOD   (Wietnauer MARKA)
                          └─ ue.LNGURUNREF=u.LNGKOD → TBLURUNEKSAHA (boş)

TBLMUSTERI (m)
  ├─ m.TXTGRUPKOD     ─→ TBLMUSTERIGRUP.TXTKOD    (müşteri tipi)
  ├─ m.TXTEKGRUPKOD   ─→ TBLMUSTERIEKGRUP.TXTKOD  (kanal — DIRECT, md33)
  └─ m.LNGKOD         ←─ TBLMUSTERIEKSAHA.LNGMUSTERIREF (saha 8 = müşteri tipi)

TBLDIST (d)
  ├─ d.TXTEKGRUP      ─→ TBLDISTEKGRUP.TXTKOD   (Wietnauer BÖLGE)
  └─ d.TXTGRUP        ─→ TBLDISTGRUP.TXTKOD     (Pernod bölge / Wietnauer dist tipi)
```

---

## 9) Ekran → Tablo matrisi
| Panorama ekranı | Ana tablolar |
|---|---|
| **Cockpit/Komuta** | TBLMSDFATURA, TBLMSDBELGEDETAY, TBLURUN, TBLURUNGRUP, TBLDIST(EKGRUP), TBLMUSTERIEKSAHA |
| **Harita** | TBLMUSTERI (koordinat+durum), TBLDIST |
| **Yönetim Kurulu** | TBLMSDFATURA, TBLMSDBELGEDETAY, TBLURUNGRUP, TBLMUSTERI |
| **Satış** | TBLMSDFATURA, TBLDIST, TBLSATISTEMSILCISI |
| **Marka** | TBLMSDBELGEDETAY, TBLURUN, TBLURUNGRUP |
| **Segment** | TBLMUSTERI, TBLMUSTERIGRUP, TBLMUSTERIEKGRUP, TBLMUSTERIEKSAHA |
| **Stok** | TBLENTDEPOSTOKDURUM* / TBLMSDDEPOHAREKET (⚠️ boş) |
| **Saha** | TBLPMPZIYARET*, TBLSATISTEMSILCISI, TBLPERSONEL |
| **Risk/Müşteri kartı** | TBLMSDFATURA, TBLMSDTAHSILAT, TBLPMPZIYARET* |
| **Auth** | TBLKULLANICI, ERCVIEWTBLKULLANICIDIST_DASHBOARD |

---

## 10) Kritik notlar
- 🔴 **Boş tablolar (Weitnauer):** `TBLSBMUSTERIEKGRUPBAGLANTI`, `TBLURUNEKSAHA`, `TBLDISTPERSONEL`, `TBLENTDEPOSTOKDURUM`, `TBLSTOKBARDEPOSTOK`, `TBLDISTGUNLUKSTOK`, `TBLRPAACIKSIPARIS`, `TBLRPABAYITEDARIKSURE`, `TBLCIROSALSEGMENTMUSTERI`. Stok ekranı ve md33'ü doğrudan etkiler.
- **DB saati donuk:** `GETDATE()` = 2026-04-17 sabit; veri güncel (son fatura 2026-08-04). Uygulama `NOW_MODE=max-invoice` ile "now" = en son fatura günü.
- **Şema inversiyonu (Wietnauer↔Pernod):** marka (TBLURUNGRUP↔TBLURUNEKGRUP), bölge (TBLDISTEKGRUP↔TBLDISTGRUP) yer değiştirir — tenant config'te tanımlı.
- **BYTTUR=0 + BYTDURUM=0** filtreleri metrik doğruluğu için zorunlu; eksikse iptal/taslak/pasif kayıtlar sızar (md19).
