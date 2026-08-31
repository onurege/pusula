# Insider — Metrik ve Hesaplama Yöntemleri

Bu doküman ürünün gösterdiği her sayının nereden geldiğini ve nasıl
hesaplandığını madde madde açıklar. Yöneticiye sunmak için.

Tüm hesaplamalar **Univera MSSQL** veritabanı üzerinden çalışır. Pahalı
sorgular yerel SQLite mirror'a cache'lenir; "Verileri yenile" butonuna
basılana kadar tekrar MSSQL'e gitmez.

---

## 0. Genel Kurallar (Her Sorguda Geçerli)

Univera fatura ve belge sistemine ait standart filtreler her sorguda
uygulanır. Bu filtreler raporun "satış" tanımını tutarlı kılar.

**Belge tipi filtresi**

- `TBLMSDFATURA.BYTTUR = 0` → satış faturası
  (1=alış, 2-4=iade, 5-6=hizmet, 98-99=iade hariç)
- `TBLMSDFATURA.BYTDURUM = 0` → aktif/onaylı belge (iptal hariç)
- `TBLDIST.BYTDURUM = 0` → aktif distribütör

**Ziyaret filtresi**

- `TBLPMPZIYARETBASLIK.TRHGIRIS IS NOT NULL` → gerçekten yapılmış ziyaret
  (rota üzerinde planlananlar değil, fiilen yapılanlar)

**Tahsilat işlem kodları**

- `100` Nakit · `104` Çek · `108` Senet · `112` Kredi Kartı
- İptal pair'leri: `102 / 106 / 110 / 114` — bunlar düşülür

**Saha belge kodları** (ziyaret içinde üretilen)

- `4` Fatura kesimi · `30` İrsaliye · `60` Sipariş
- İptal pair'leri: `6 / 32 / 62`

> Belge ve tahsilat tipi kodları Univera'nın **5190 numaralı `SSP_RPT_5190_ZIYARET_ANALIZI`** raporundan birebir alınmıştır.

---

## 1. Harita — Müşteri Renk Kodlaması

Harita üzerindeki her nokta bir müşteridir. Marker rengi müşterinin
**risk seviyesini** gösterir. Risk seviyesi senkronizasyon sırasında bir
kez hesaplanır, SQLite'a yazılır; sayfa açılışında tekrar MSSQL'e
gidilmez.

### 1.1 Hesaplanan Alanlar

| Alan | Kaynak | Hesaplama |
|---|---|---|
| `daysSinceLastSale` | `TBLMSDFATURA.TRHISLEMTARIHI` | `DATEDIFF(day, MAX(TRHISLEMTARIHI), GETDATE())` filtre: `BYTTUR=0, BYTDURUM=0` |
| `daysSinceLastVisit` | `TBLPMPZIYARETBASLIK.TRHGIRIS` | `DATEDIFF(day, MAX(TRHGIRIS), GETDATE())` filtre: `TRHGIRIS IS NOT NULL` |
| `ciro30` | `TBLMSDFATURA.DBLNETTUTAR` | Son 30 günün toplamı |
| `ciroPrev30` | `TBLMSDFATURA.DBLNETTUTAR` | Önceki 30 günün (gün -60 ile -30 arası) toplamı |

### 1.2 Risk Seviyesi Kuralları

Sırayla kontrol edilir, ilk uyan kural kazanır.

**LOW (gri):**

1. Hiç satış kaydı yok **veya** son satış 180+ gün önce

**HIGH (kırmızı):**

2. 60+ gün sessiz **ve** geçmişte alım var
3. 30+ gün sessiz **ve** önceki 30 gün cirosu ≥ 10.000 ₺
4. Önceki 30 gün ≥ 5.000 ₺ **ve** son 30 gün, önceki 30 günün %50'sinden az

**MEDIUM (amber):**

5. 30-59 gün sessiz **ve** geçmişte alım var
6. 60+ gün ziyaretsiz **ve** geçmişte alım var
7. Önceki 30 gün ≥ 1.000 ₺ **ve** son 30 gün, önceki 30 günün %70'inden az

**ACTIVE (yeşil):**

8. Son 30 gün içinde satış var **ve** ciro > 0

**LOW (gri):**

9. Diğer (yukarıdaki kurallara uymayan kıyı durumlar)

**Mantık özeti:** "Eskiden büyük müşteri sessizleşmiş" durumunu KIRMIZI;
"erken uyarı sinyali" olan durumları AMBER; sağlıklı aktif satışı olanları
YEŞİL olarak işaretler.

### 1.3 Risk Nedeni (Modal İçinde)

Müşteri kartı açıldığında risk rozetinin altında "Neden: ..." satırı
gösterilir. Bu metin, hangi kuralın tetiklendiğine göre o kuralın spesifik
sayılarını içerir. Örnek:

> Ciro önceki 30 günde 78.000 ₺ iken son 30 günde 35.000 ₺'ye düştü (%55 kayıp)

---

## 2. Müşteri Detay Kartı (Modal)

Müşterinin son 30 günlük operasyonel özeti. Modal açıldığında 4 paralel
SQL sorgusu çalışır; sonuç SQLite cache'e yazılır, aynı müşteri tekrar
açılırsa anında gelir.

### 2.1 Son 30 Gün Özet

| KPI | Kaynak | SQL |
|---|---|---|
| **Ciro** | `TBLMSDFATURA.DBLNETTUTAR` | `SUM(DBLNETTUTAR)` filtre: `BYTTUR=0, BYTDURUM=0, TRHISLEMTARIHI ≥ son 30 gün` |
| **Fatura** | `TBLMSDFATURA` | `COUNT(*)` aynı filtre |
| **Ziyaret** | `TBLPMPZIYARETBASLIK` | `COUNT(*)` filtre: `TRHGIRIS IS NOT NULL`, son 30 gün |
| **Son fatura** | `TBLMSDFATURA.TRHISLEMTARIHI` | `MAX(TRHISLEMTARIHI)` |
| **Son ziyaret** | `TBLPMPZIYARETBASLIK.TRHGIRIS` | `MAX(TRHGIRIS)` |

### 2.2 Tahsilat (Saha Tahsilatı, Son 30 Gün)

Tahsilatlar Univera'da iki yerden tutulur — ziyaret içi tahsilat ve serbest
tahsilat. Bu metrik **ziyaret içi tahsilatı** kapsar (5190 raporu mantığı).

| Tip | İşlem Kodu | Kaynak |
|---|---|---|
| Nakit | `100` | `TBLMSDTAHSILAT.DBLTUTAR` |
| Çek | `104` | `TBLMSDTAHSILAT.DBLTUTAR` |
| Senet | `108` | `TBLMSDTAHSILAT.DBLTUTAR` |
| Kredi Kartı | `112` | `TBLMSDTAHSILAT.DBLTUTAR` |

**İptal pair dışlama:** Her tahsilat işlem kodunun bir "iptal" karşılığı
vardır (102/106/110/114). Aynı `LNGBELGEKOD` için iptal kaydı varsa o
tahsilat sayılmaz.

**JOIN zinciri:**
```
TBLPMPZIYARETDETAY  d
  → INNER JOIN TBLPMPZIYARETBASLIK z ON z.LNGKOD = d.LNGBASLIKKOD
  → INNER JOIN TBLMSDTAHSILAT t      ON t.LNGKOD = d.LNGBELGEKOD
```

### 2.3 Ziyaret Detayı

| KPI | Kaynak | Açıklama |
|---|---|---|
| **Rut içi** | `TBLPMPZIYARETBASLIK.BYTRUTKODU = 0` | Planlanan rotada yapılan ziyaret |
| **Rut dışı** | `TBLPMPZIYARETBASLIK.BYTRUTKODU = 1` | Plan dışı yapılan ziyaret |

### 2.4 Sahada Belge (Ziyaret İçinde Üretilen Belgeler)

| Belge | İşlem Kodu | Kaynak | İptal Pair |
|---|---|---|---|
| Fatura kesildi | `4` | `TBLPMPZIYARETDETAY` | 6 |
| İrsaliye | `30` | `TBLPMPZIYARETDETAY` | 32 |
| Sipariş | `60` | `TBLPMPZIYARETDETAY` | 62 |

Her kayıt için aynı `LNGBELGEKOD`'da iptal işlem kodu varsa o belge
sayılmaz.

---

## 3. Foresight (Öngörü) — 14 Gün Sonraki Sinyaller

"Öngörü al" butonuna basıldığında çalışır. 4 farklı veri kanalını paralel
çeker, tek bir Gemini LLM çağrısıyla yönetici brifi + 2-3 aksiyon üretir.

**Agent loop YOKTUR** — sinyaller deterministiktir, LLM sadece cümle
kuruyor. LLM "düşüşe katkı sağladı" gibi anlamsız ifadeler kurarsa
deterministik tabana düşülür.

### 3.1 Sinyal 1: Takvim (Calendar)

**Kaynak:** `data/calendar/tr-2026.json` (statik dosya)

**Ne dahil:** Dini günler (Ramazan, bayramlar), milli günler, anneler/babalar
günü, sevgililer günü, okul açılış/kapanış, maaş günü (15 ve 1'i her ay).

Her olay için **kategori ipuçları** tanımlı: Ramazan → hurma/pekmez/un,
Sevgililer Günü → çikolata/şarküteri/şarap, vs. LLM bu ipuçlarını
kullanarak ürün önerisi yapar.

### 3.2 Sinyal 2: Geçen Yıl Aynı Hafta (YoY)

Müşterinin **geçen yıl aynı takvim haftasında** ne aldığını gösterir.

**SQL özü:**
```sql
TBLMSDFATURA f
  + TBLMSDBELGEDETAY d  (fatura → ürün satırı)
  + TBLURUN u            (ürün adı)
  + LEFT JOIN TBLURUNGRUP g (ürün grubu — yoksa ürün adına düşer)
WHERE f.LNGMUSTERIKOD = ?
  AND TRHISLEMTARIHI in [bugün-365-3, bugün-365+14]
  AND BYTTUR = 0 AND BYTDURUM = 0
GROUP BY COALESCE(g.TXTAD, u.TXTAD)
ORDER BY ciro DESC
```

**Çıktı:** En çok ciro yapan 10 ürün grubu/ürünü, miktarlarıyla.

### 3.3 Sinyal 3: Düşmüş Kategoriler (Dropped Categories)

Müşterinin **eskiden alıyordu ama son 30 günde hiç almadığı** kategoriler.

**Kural:**
- Baseline pencere: gün -120 ile -30
- Recent pencere: son 30 gün
- Baseline'da en az **2 farklı günde** alım var
- Recent'te toplam ciro = **0**
- En fazla 20 kategori, baseline cirosuna göre azalan sıralı

**Urgency tier:**
- **HIGH**: baselineCiro ≥ 100.000 ₺ **ve** daysSinceLast ≥ 30 — veya baselineCiro ≥ 250.000 ₺ (her durumda)
- **MEDIUM**: baselineCiro ≥ 20.000 ₺ ve 30+ gün — veya baselineCiro ≥ 50.000 ₺
- **LOW**: diğer

### 3.4 Sinyal 4: Segment Kıyası (Cohort Recent)

Müşteriyi (şehir + ciro bandı) segmentine yerleştirir, **aynı segmentten
≥%30'unun** bu hafta aldığı ama bu müşterinin almadığı kategorileri çıkarır.

**Segment tanımı:**
| Müşterinin 30g cirosu | Segment bandı (alt-üst) |
|---|---|
| ≥ 25.000 ₺ | 15.000 - 9.999.999 ₺ |
| 5.000 - 25.000 ₺ | 2.500 - 50.000 ₺ |
| 500 - 5.000 ₺ | 100 - 10.000 ₺ |
| < 500 ₺ | 0 - 5.000 ₺ |

**Segment ayrımı yapay (hand-crafted)**, embedding/ML değil. v1 için
yeterli; learned similarity sonraki faz.

### 3.5 Risk Flags

`dropped` listesindeki **HIGH urgency** olanlar `riskFlags` olarak ayrı
listelenir, brief'in en başında "Yüksek öncelikli risk" banner'ında
gösterilir.

---

## 4. Sales Radar

`/radar/sales` sayfası. Bölge yöneticisi için günlük satış manzarası.

### 4.1 Anomaly Bloğu: "Bugün Dikkat Çekenler"

Distribütör başına son **7 günün cirosu**, önceki **30 günün haftalık
ortalamasıyla** kıyaslanır.

**Formül:**
- `guncel` = son 7 gün ciro
- `beklenen` = önceki 30 günün cirosu × (7/30) — yani aynı uzunluktaki
  pencereye normalize edilmiş geçmiş ortalama
- `degisim_pct` = (guncel − beklenen) / beklenen × 100

Sapma %15'in üstündeyse listelenir, %30 üstü "bad" tonu.

**Filtre:** Sadece `BYTDURUM=0` aktif distribütörler, `BYTTUR=0 ve
BYTDURUM=0` onaylı satış faturaları, önceki dönem ciro > 0.

**Sıralama:** Mutlak sapma yüzdesine göre azalan, ilk 5.

### 4.2 KPI Bloğu

| KPI | Hesaplama | Eşikler (good/warn/bad) |
|---|---|---|
| Satış Cirosu | `SUM(DBLNETTUTAR)` son 30 gün | 1M / 100k / 0 ₺ |
| Satış Faturası | `COUNT(*)` son 30 gün | 100 / 10 / 0 |
| Aktif Distribütör | `COUNT(DISTINCT LNGDISTKOD)` son 30 gün | 20 / 5 / 0 |

### 4.3 Grafik: En Çok Satış Yapan Distribütörler

Top 10 distribütör, son 30 günde toplam ciroya göre. Yatay bar chart.

### 4.4 Grafik: Günlük Satış Cirosu Trendi

Son 30 günün günlük ciro eğrisi (line chart).

---

## 5. Tahsilat Radar

`/radar/tahsilat` sayfası. Saha tahsilat dengesi — kim topluyor, kim
toplamıyor.

### 5.1 Anomaly: Tahsilat Oranı Değişimi

Distribütör başına **tahsilat oranı** (= saha tahsilatı / fatura) son 7
gün için, önceki 30 gün ortalamasıyla kıyaslanır.

**Formül:**
- `guncel_oran` = (son 7g tahsilat / son 7g fatura) × 100
- `beklenen_oran` = (önceki 30g tahsilat / önceki 30g fatura) × 100
- `degisim_pct` = (guncel_oran − beklenen_oran) / beklenen_oran × 100

### 5.2 KPI Bloğu

| KPI | Hesaplama |
|---|---|
| Toplam Fatura | `SUM(DBLNETTUTAR)` son 30g, satış faturaları |
| Toplam Tahsilat | `SUM(DBLTUTAR)` son 30g, ziyaret içi nakit/çek/senet/kk |
| Tahsilat Oranı | toplam tahsilat / toplam fatura × 100 (eşik: 80/50/30 %) |

### 5.3 Grafik: En Büyük Açık Bakiye

`açık_bakiye = fatura − tahsilat` (son 30 gün, distribütör bazında).
Negatif olanlar (fazla tahsilat) listelenmez. Top 10, azalan.

### 5.4 Tablo: Distribütör Özet

Her distribütör için fatura, tahsilat, açık bakiye, tahsilat yüzdesi.
Yüzdesi düşük olanlar üstte.

### 5.5 Önemli Not — Saha Tahsilatı Kapsamı

Bu radar **sadece ziyaret içinde alınan tahsilatları** sayar. Banka havalesi
veya merkez ofise gelen ödeme bu hesaba dahil değildir. Saha rep'inin
gerçekten ne kadar topladığını ölçer, müşterinin ödeyip ödemediğini değil.

Univera'da "müşteri açık bakiyesi" (cari hareket) ayrı bir tablodan
hesaplanır; bu radar'a v2'de eklenebilir.

---

## 6. Temsilci Performans Radar

`/radar/temsilci` sayfası. Satış temsilcisi bazında performans.

### 6.1 Bağlantı Yolu

`TBLMSDFATURA.LNGSTKOD → TBLSATISTEMSILCISI.LNGSTKOD` foreign key ile
verifiye. Tahsilatlar da aynı kanaldan: `TBLMSDTAHSILAT.LNGSTKOD →
TBLSATISTEMSILCISI.LNGSTKOD`.

### 6.2 Anomaly: Temsilci Ciro Sapması

**"Beklenen" geçmiş aya göre, hedeflere göre değil.**

- `guncel` = temsilci başına son 7g ciro
- `beklenen` = önceki 30g ciro × (7/30) — _temsilcinin kendi son aylık
  ritmi_
- `degisim_pct` = (guncel − beklenen) / beklenen × 100

Bu yaklaşım her temsilciyi **kendi kendisiyle** kıyaslar; bölge büyüklüğü
veya hedef sistemine ihtiyaç duymaz. Hedef-bazlı kıyas için temsilci
hedeflerinin bir yerde tanımlı olması gerekir; v2'de eklenebilir.

### 6.3 KPI Bloğu

| KPI | Hesaplama |
|---|---|
| Toplam Ciro | `SUM(DBLNETTUTAR)` son 30g, `LNGSTKOD IS NOT NULL` faturalar |
| Aktif Temsilci | `COUNT(DISTINCT LNGSTKOD)` son 30g |
| Toplam Fatura | `COUNT(*)` son 30g |

### 6.4 Grafik: En Çok Ciro Yapan Temsilciler

Top 10, son 30 günde toplam ciroya göre. Adı `TBLSATISTEMSILCISI.TXTSTAD`.

### 6.5 Tablo: Tüm Temsilci Özeti

Her temsilci için: ad, bağlı distribütör, ciro, fatura sayısı, tahsilat.
Ciroya göre azalan.

---

## 7. Müşteri Kayıp Riski Sayfası (`/risk`)

"Bu hafta arayın" listesi. Map'in pre-compute ettiği HIGH risk
müşterilerini ranked liste olarak gösterir.

### 7.1 Sıralama Mantığı

Müşteriler **kayıp ciro** miktarına göre azalan sıralı:
- `kayip = ciroPrev30 − ciro30`

Yani önceki 30 günde 100k ₺ alıp şimdi 20k ₺'ye düşen müşteri 80k kayıpla
1. sırada görünür. Hiç almayan ama eskiden 50k yapan da kayıp listesinde
50k ile.

### 7.2 Görselleştirme

- Üstte toplam kayıp ciro miktarı
- Müşteri ünvanı + distribütör + şehir + önceki 30g + son 30g + kayıp +
  risk nedeni
- Şehir filtresi + müşteri arama
- "Çarşaf indir (CSV)" butonu — Excel'de açılabilir, Türkçe karakter
  korunur (UTF-8 BOM)

---

## 8. AI Analizi (Customer Modal — "AI Analizi al")

Müşteri kartında "AI Analizi al" butonuna basıldığında çalışan agent loop.

### 8.1 Çalışma Prensibi

Gemini agent (function calling) ile şu döngü:
1. `retrieve_schema` — RAG'den ilgili tabloları çek
2. `run_sql` — SELECT sorgusu çalıştır (yalnızca okuma, DML yasak)
3. `finalize` — sonuçtan Türkçe yönetici özeti üret

Pre-seed: kullanıcının prompt'unda geçen `TBL*` tablo adları (örn.
`TBLMSDFATURA`) otomatik şemaya enjekte edilir, agent retrieve_schema'da
kaybolmaz.

### 8.2 Brief Kalite Filtresi

SQL satır döndürdüğünde, brief'i deterministik olarak **gerçek satırlardan
yeniden yazma** mekanizması devrede. Modelin "en yüksek katkıyı sağlayan
ürün grupları belirlenmiştir" gibi içi boş ifadelere düşmesi engellenir.

### 8.3 Yasaklı İfadeler (Sistem Promptu)

- "Belirlenmiştir", "önemlidir", "değerlendirilmiştir"
- "Düşüşe katkı sağlamak" (pozitif fiil, düşüş için yanlış)
- Pasif fiiller: "yapılması", "edilmesi", "geliştirilmesi"
- SQL/teknik jargon: "tablo", "sorgu"

Bunları içeren brief otomatik regex ile temizlenir veya deterministik
metne düşürülür.

---

## 9. Veri Tazeleme ve Cache Stratejisi

Performans için pahalı sorgular **yerel SQLite mirror'a** cache'lenir.

### 9.1 Cache Domain'leri

- **`map_customers` (tablo)** — anahtar: müşteri ID. Senkronizasyon sırasında
  hesaplanan risk bilgileri.
- **`customer-detail`** — anahtar: `<id>:<days>`. Modal'daki son 30 gün
  metrikleri (ciro, fatura, ziyaret, tahsilat).
- **`foresight`** — anahtar: `<id>:<windowDays>`. Foresight 4-sinyal +
  yönetici brifi + aksiyonlar.
- **`radar:<id>`** — anahtar: params hash. Radar block sonuçları + brief.

### 9.2 Yenileme Tetikleyicileri

- **Map "Verileri yenile" butonu** — `map_customers` tablosunu MSSQL'den
  yeniden çeker. Ayrıca `customer-detail` ve `foresight` cache'lerini
  siler (alt veri değişti).
- **Radar "Yenile" butonu** — sadece o radar'ın cache'ini günceller.
- **Modal "Yenile" butonu (foresight)** — sadece o müşterinin foresight'ını
  yeniden hesaplar.

### 9.3 Otomatik Yenileme YOK

Sistem **manuel yenileme** modelinde çalışır — kullanıcı talep edene kadar
cache'lenen veriler güncellenmez. Bu seçim performans/maliyet
optimizasyonu için bilinçli. Otomatik gece sync'i ileride eklenebilir.

---

## 10. Önemli Uyarılar

1. **Tahsilat radarı** ziyaret içi tahsilatları sayar. Müşteri açık
   bakiyesi farklı bir hesap — Univera'nın `TBLCARIHAREKET` veya benzeri
   tablosundan çekilir, bu üründe henüz yok.

2. **Temsilci anomaly'si geçmiş bazlı**, hedef bazlı değil. Hedef sistemi
   eklenmedikçe "ay hedefinin %X'inde" bilgisi gösterilemez.

3. **Risk seviyesi eşikleri** Univera distribütör ölçeğine göre ayarlandı
   (500-50k ₺/ay tipik müşteri). Farklı ölçekte (örn. büyük bayi ağı)
   çalıştırılırsa `computeRiskTier()` fonksiyonunda eşikler güncellenmeli.

4. **Foresight segment kıyası** hand-crafted (şehir + ciro bandı) — ML
   embedding değil. Sonraki fazda öğrenilmiş benzerlik eklenebilir.

5. **AI Analizi** Gemini API kullanır. 503/429 alındığında otomatik retry
   + flash → flash-lite fallback'i mevcut. Her çağrı yaklaşık 2-5 saniye.

---

*Doküman tarihi: 2026-05-11 itibarıyla mevcut sürüm üzerinden hazırlandı.
Yeni metrikler eklendikçe güncel tutulmalı.*

---

## Ek — PDF Olarak Almak İçin

Bu dokümandan temiz bir PDF üretmek için iki yol var:

### Yol 1 — Pandoc (en güvenilir, LaTeX kurulu olmalı)

```bash
pandoc docs/METRIKLER.md \
  -o docs/METRIKLER.pdf \
  --pdf-engine=xelatex \
  -V geometry:"margin=1.5cm,a4paper" \
  -V fontsize=10pt \
  -V mainfont="Helvetica Neue" \
  -V monofont="Menlo" \
  -V colorlinks=true \
  --toc
```

### Yol 2 — Chrome'da Print (kurulum gerekmez)

`docs/METRIKLER.html` dosyasını üretip Chrome'da aç, **Yazdır → PDF olarak
kaydet** yap. Yazdırma diyaloğunda:

- **Sayfa boyutu:** A4
- **Kenar boşlukları:** Dar (Narrow / Custom 1cm)
- **Ölçekleme:** Sığdır (Fit to page)
- **Arka plan grafikleri:** Açık (rozet renkleri korunsun diye)

HTML üretmek için en hızlı yol:

```bash
npx marked docs/METRIKLER.md > docs/METRIKLER.html
```

Veya VS Code "Markdown PDF" eklentisi de aynı işi yapar — sağ tık → "Export
to PDF". Eklentinin ayarlarında `pageOrientation: portrait`, `format: A4`
seçili olsun.

### Yazılar Hâlâ Üst Üste Geliyorsa

- **Tablolar çok geniş kalıyor:** Yazdırma diyaloğunda sayfa yönünü **yatay
  (landscape)** yap.
- **Font çok büyük:** Ölçeklemeyi **%80-90** civarına çek.
- **VS Code eklentisi sıkıştırıyor:** Pandoc'a geç — tablo word-wrap'i daha
  iyi yönetir.
