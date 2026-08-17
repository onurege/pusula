# Weitnauer Pusula v3 — Gelen Talepler & Düzeltmeler (sunum sonrası)

Sunum sonrası gelen 44 talebin temize çekilmiş, gruplanmış ve netleştirilmiş hali.
Her madde no'su parantezde `(mdN)` — orijinal listeyle izlenebilirlik için.

---

## ✅ Kilitlenen kararlar (netleştirmeler)

| Konu | Karar |
|------|-------|
| **70cl / Hacim (md7)** | `Hacim = Σ (TBLMSDBELGEDETAY.DBLMIKTAR × TBLURUN.DBLLITRE)`. DBLLITRE = kapasite_cl / 70 (70CL→1, 75CL→1.071, 100CL→1.428…). DB'de doğrulandı. |
| **Reel TL (md3)** | IAS 29 / TMS 29 (enflasyon muhasebesi) mantığı: her tarihsel TL, **TÜFE** ile **raporlama ayına** deflate edilir. `Reel = Nominal × (TÜFE[raporlama ayı] / TÜFE[değerin ayı])`. Aylık granülarite. YoY'da geçen yıl bugüne şişirilir → reel büyüme. |
| **Yetki (md5, 10)** | **Panel-bazlı görünürlük + veri-scope.** Bölge müdürü yalnız kendine bağlı **şehir / distribütör / nokta** verisini görür. |
| **Aktif/Pasif (md19)** | Tablo `BYTDURUM` durumu esas (pasif dist altındaki müşteriler aktif sayılmaz). |
| **Sync + AI (md1, 4)** | Senkron + Claude brief **gece 03:00 job'ında 1 kez** üretilir, gün boyu cache'ten servis. |
| **FKMS (md23)** | Fatura Kesilen Müşteri Sayısı. |
| **Nokta başına satış hızı (md27)** | Seçili dönemde `ciro / aktif nokta sayısı`. |
| **Others (md34)** | Gösterilen (stratejik) markalar + kalan tüm markalar "Others" altında toplanır. |

---

## 🧱 1) OMURGA — Ortak altyapı (bir kez yapılır, her ekrana yansır)

- **Global filtre çubuğu** (Bölge · Kanal · Ürün Grubu · Dönem) demo değil, gerçek/çalışır. *(md2)*
- **Dönem seçimi:** Son 30g · MTD · YTD · Q1/Q2/Q3 + serbest tarih aralığı (ör. 1–29 Tem 2026); tüm panelleri sürer. *(md2, 11, 21, 42, 44)*
- **YoY dinamik:** seçilen dönemin bir önceki yılıyla kıyas (harita dahil). *(md2)*
- **Birim TL ↔ Hacim (70cl):** tüm hesap + karşılaştırmalar birime göre değişir. *(md6, 7, 16, 26, 34)*
- **"Diğer" + dip toplam deseni:** Top N (8/10) + kalanlar "Diğer" + en altta dip toplam. *(md16, 17, 18, 29, 30, 36, 37)*
- **Distribütör filtresi (Tümü / Aktif / Pasif):** birden çok ekranda ortak. *(md20, 42, 43, 44)*
- **Reel TL toggle** (IAS 29 / TÜFE). *(md3)*

## ⚙️ 2) Sistem

- Refresh butonu kaldır → gece 03:00 sync job. *(md1)*
- UNIQUE AI "Bu sabahın yorumu" → **Claude**; gece job'ında 1 kez üret + cache. *(md4)*
- **Yetkilendirme:** admin panel, tüm kullanıcılar; ekran/parça-bazlı görünürlük + veri-scope; bölge müdürü → yalnız kendine bağlı dist/nokta/şehir. *(md5, 10)*

## 🖥️ 3) Cockpit

- KPI şeridi: **ilk sıra Hacim (70cl)**; karşılaştırmalar filtreye göre. *(md6)*
- Harita **sabit** (scroll yok). *(md8)*
- **Kanal Mix:** "Son 12 Ay" kaldır → filtreye bağla + **pie chart** ekle. *(md14)*
- **Müşteri Tipi:** "Son 12 Ay" kaldır → filtreye bağla; müşteri ek gruptan çek. *(md15)*
- **Ürün Grubu × Dönem:** başlıktan "Net Ciro Karşılaştırma" kaldır; birim TL/Hacim; Top8 + Diğer + dip toplam. *(md16)*
- **Heatmap:** Top8 + Diğer. *(md17)*
- **Ürün Grubu Portföyü (2 yıllık yörünge):** Top8 + Diğer. *(md18)*
- **Müşteri Tipi × Marka paneli:** müşteri ek grubu; tarih aralığı; stratejik markalar + **Others** (kalan markalar); Hacim/Ciro toggle. *(md34)*

## 🗺️ 4) Harita

- Üstte dönem filtresi → alttaki satış-aktivite filtresini değiştirir. *(md11)*
- Arama: ünvan + **müşteri takip kodu** + **müşteri kodu**. *(md9)*
- **Aktif müşteri sayısı denetimi:** 23.738 nokta fazla; pasif dist altındakiler aktif sayılıyor mu (BYTDURUM). *(md19)*

## 👤 5) Müşteri kartı (nokta detayı)

- **Risk skoru** nasıl hesaplanıyor / neyi dikkate alıyor göster. *(md12)*
- **Foresight** alanları (Risk sinyali · 14 günde olay · düşmüş kategori · segment fırsatı) → ikon-hikâye ya da anlaşılır isim. *(md13)*

## 💰 6) Satış

- **Tümü/Aktif/Pasif** distribütör filtresi. *(md20)*
- Tarih aralığı + birim filtresi. *(md21)*
- **Distribütör leaderboard kaldır.** *(md25)*
- Top distribütör cirosu → birim değişince **Hacim**. *(md26)*
- **Nokta başına satış hızı** (ciro / aktif nokta). *(md27)*

## 🏷️ 7) Marka

- **Excel dökümü.** *(md28)*
- Top 10 SKU sonrası **"Diğer"**. *(md29)*
- Marka penetrasyonu altına **"Diğer"**. *(md30)*
- **30g vs 90g vs YTD karşılaştırma kaldır.** *(md31)*
- Marka Portföyü altına **other + dip toplam**. *(md36)*
- Top 10 marka penetrasyonu → **other + dip toplam**. *(md37)*

## 🧩 8) Segment / Müşteri grup

- **Cirosal segment kaldır.** *(md32)*
- Segment kırılımı: **müşteri grup + ek grup** → toplam **3 kırılım**. *(md24)*
- **"Tanımlı ek grup yok" bug'ı** düzelt (Pernod'da da yaşandı — ek grup FK bağı). *(md33)*
- Ek grup/nokta bazında **harcanan iskonto** ekle. *(md35)*

## 📦 9) Stok

- **Tüm SKU'lar** (uzunsa pagination). *(md38)*
- "Yoldaki miktar" + ilk bitecek SKU'daki "yolda" kolonu **kaldır**. *(md39)*
- Marka bazında stok riski → **tüm markalar**. *(md40)*
- Distribütör seçimi + tarih aralığı. *(md42)*

## 🚶 10) Saha

- Temsilci performansı: müşteri kolonu → **aktif müşteri sayısı**. *(md41)*

## ⚠️ 11) Risk

- **Distribütör filtresi** ekle. *(md43)*

## 🎯 12) İskonto

- Tarih aralığı + distribütör filtresi. *(md44)*

## 📊 13) Yönetim

- **Top Müşteri analizi → Top Distribütör analizi.** *(md22)*
- Top dist analiz alanı: **Aktif müşteri sayısı (kapsam) + Fatura Kesilen Müşteri Sayısı (FKMS)**. *(md23)*

---

## Önerilen sıra
1. **Omurga (1) + Sistem (2)** — global filtre çubuğu, birim (70cl), dönem/tarih aralığı, dinamik YoY, Reel TL, sync job, yetkilendirme. (Diğer maddelerin çoğu buna bağlı.)
2. Omurgaya bağlı ekran maddeleri (Cockpit, Satış, Marka, Segment, Stok, Saha, Risk, İskonto, Yönetim).
3. Bağımsız iyileştirmeler ("Diğer"+dip toplam, Excel, açıklamalar, bug'lar).
