# NORA 4Sight FMCG Demo

Bu repo, **NORA 4Sight**'nın FMCG sektörü prospect sunumları için demo
varyantıdır. Karma FMCG verisi (çikolata, bisküvi, kahve, temizlik, atıştırmalık
karışık) ile çalışır. Pernod'un canlı sahasına bağlı **değildir** — tamamen
sentetik veri üzerinden çalışır.

## Hızlı Başlangıç

Gereksinimler: Node 22+, npm 10+, macOS/Linux.

```bash
# 1) Bağımlılıklar
npm install

# 2) İki terminal aç:

# Terminal 1 — API server
npm run api:start:fmcg

# Terminal 2 — Dashboard
npm run dashboard:dev:fmcg
```

Tarayıcı: <http://localhost:3000>

Beklenen görüntü:
- Navbar'da `FM` logosu + "NORA 4Sight" başlığı
- `/v2` ana sayfasında "Bu Sabah Sahada Ne Oluyor"
- 2.000 fake müşteri, 30 distribütör, 81 il
- Risk dağılımı: ~%56 healthy / %26 watch / %7 risk / %11 critical
- Komuta sayfasında ürün gruplarıyla heatmap, satış matrisi, region YoY

## Veriyi Yeniden Üretmek

Demo SQLite (`data/fmcg-demo.sqlite`) repo'ya commitlidir; clone sonrası
ek bir adım gerekmez. Veriyi sıfırdan yeniden üretmek istersen:

```bash
TENANT=fmcg-demo npx tsx tools/seed-fmcg-demo.ts
```

Determine PRNG ile aynı seed → aynı çıktı. Test screenshot'ları arasında
rakamlar değişmez.

## Mimari

Tek codebase, tenant abstraction ile iki sektör destekler:

- **Pernod (alkol)** — `TENANT=pernod` (default), MSSQL'e bağlı canlı kullanım
- **FMCG demo** — `TENANT=fmcg-demo`, SQLite'tan synth veri

Pernod-özel terimler (9L, OTV, "Pernod Müşteri Tipi") tenant config'inden
okunur (`packages/core/src/tenant/configs/`); FMCG mode'da gizlenir veya
generic terimle değiştirilir.

Yeni müşteri eklemek için:

1. `packages/core/src/tenant/configs/<isim>.ts` oluştur
2. `packages/core/src/tenant/index.ts` REGISTRY map'ine ekle
3. `TENANT=<isim>` env var ile aktive et

## Üretim Deploy Notu

Tek deploy bir tenant'a hizmet eder. Multi-tenant SaaS değil — her müşteri
kendi container/VPS'inde kendi config + DB ile çalışır. Bu sayede:

- Her müşterinin verisi izole (ayrı SQLite dosyası)
- Bir müşterinin yükü diğerini etkilemez
- Branding/UI çeşitlemesi config dosyası kadar basit

## FMCG Demo'da Çalışmayan Şeyler

Demo SQLite tabanlı olduğu için MSSQL-bağımlı bazı endpoint'ler işlemez:

- `Verileri Yenile` butonu — saha DB'sine sync yapmaya çalışır, hata verir
  (demo data sabit; yenilemeye gerek yok)
- Finance Agent (Komuta'daki bölge YoY analizi) — Gemini + MSSQL gerektirir
- `/reports` üretici — Gemini + MSSQL
- Customer foresight modal — MSSQL

Bunlar üretim deploy'unda canlı veriyle çalışır; demo sunumunda dokunulması
gereken alanlar değil.

## Lisans

Özel/Ticari. © Enroute.
