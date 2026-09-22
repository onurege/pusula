# Insider Kurulum Kılavuzu (Windows, git yok, sürükle-bırak)

Bu kılavuz, Insider'ı **git kurulu olmayan bir Windows müşteri sunucusuna**
zip'ten kurmak içindir. Tüm komutlar PowerShell'de çalıştırılır (cmd.exe
DEĞİL).

## Varsayımlar (baştan açıkça)

- **Node.js 22 LTS** sunucuda kurulu ve **internet erişimi** var (`npm
  install` sırasında `better-sqlite3` için Windows x64 önceden-derlenmiş
  (prebuild) ikili dosya indirilir).
- Bu paket **ÖNCEDEN BUILD EDİLMİŞ** gelir (`apps/dashboard/.next` pakette
  dahil) — müşteri makinesinde `next build` normalde **çalıştırılmaz**.
  Nedeni ve kanıtı aşağıda "Neden önceden build?" bölümünde.
- Gerçek (canlı) kurulum — `ALLOW_DEMO_AUTH`/`DEMO_LOGIN_*` **YOK**. Giriş,
  müşterinin kendi MSSQL `TBLKULLANICI` tablosuna karşı yapılır.
- Bu kılavuz **gerçek bir Windows sunucusunda test EDİLMEDİ** — kod okunarak
  ve build çıktısı (route tablosu) macOS'ta incelenerek hazırlandı. "Bunu
  doğrulayamadım" notları ilgili yerlerde açıkça işaretli.
- DB bağlantısı normal yolda **kod yazılmadan**, tarayıcıdan `/setup`
  ekranıyla girilir (kodsuz onboarding). MSSQL kimlik bilgileri hiçbir
  script/`.env.ornek` içine gömülmez.

## Neden önceden build? (kanıt)

`apps/dashboard/app/layout.tsx` kök layout'u, aktif `TENANT` id'si ne
REGISTRY'de (`pernod`/`pernod-demo`/`fmcg-demo`/`wietnauer`) ne de bir
tenant-tanım dosyasında varsa (`isTenantFullyMissing() === true`) her istekte
Next'in `headers()` API'sini çağırır — bu, Next'i o route için **dinamik
render**e (istek-başı sunucu render) zorlar.

Bunu doğrulamak için `apps/dashboard`'da iki farklı `TENANT` ile `next build`
çalıştırıldı:

- `TENANT` **hiç verilmeden** (varsayılan `pernod`'a düşer, REGISTRY'de
  tanımlı): route tablosunda `/`, `/login`, `/admin`, `/admin/konfigurator`,
  `/setup` gibi sayfalar **`○` (statik, build-zamanında önceden-render)**
  çıktı. Yani bu sayfalar **pernod'un** marka/etiket bilgisiyle build-zamanında
  donduruluyor — başka bir müşteri kutusuna böyle bir build'i koymak YANLIŞ
  olurdu.
- `TENANT=deneme-yeni-musteri` (REGISTRY'de yok, tanım dosyası yok — tam
  olarak yeni bir müşterinin ilk-boot durumu) ile: route tablosundaki **TÜM
  24 route `ƒ` (dinamik)** çıktı — hiçbiri statik olarak önceden-render
  edilmedi.

Bu yüzden paketleme scripti (`paketle.mjs`) build'i **kasıtlı olarak bilinen
hiçbir tenant id'siyle eşleşmeyen bir yer-tutucu** (`kurulum-oncesi-yer-tutucu`)
ile çalıştırır — bu, hangi gerçek müşteri kutusuna konursa konsun route
tablosunun tamamen dinamik kalmasını garantiler; müşterinin gerçek `TENANT`
değeri ve marka bilgisi **her istekte, çalışma zamanında** okunur, build'e
hiçbir şey gömülmez.

**Doğrulayamadığım nokta:** `.next` çıktısı bu paketleme sırasında **macOS**
üzerinde üretiliyor. Next'in prod build çıktısının (bu depoda `next.config.ts`
içinde `output: "standalone"` KULLANILMADIĞI için) işletim sistemleri arası
taşınabilir olduğunu (yani macOS'ta build edilip Windows'ta `next start` ile
sorunsuz çalıştığını) literatürden/tasarımdan biliyorum ama **gerçek bir
Windows makinesinde çalıştırıp doğrulamadım**. Bu riske karşı `kur.ps1
-ZorlaBuild` bir kurtarma yolu olarak eklendi (aşağıya bakın).

## Adım 0 — Zip'i çıkarın

1. Zip dosyasını sunucuya kopyalayın (USB/RDP dosya paylaşımı/vb.).
2. Sağ tık → "Tümünü Çıkart" (veya `Expand-Archive`) — örnek hedef: `C:\Insider`.
3. PowerShell'i **o klasörde** açın (`C:\Insider` içine `cd` yapın veya
   klasörde sağ tık → "Burada PowerShell penceresi aç").

```powershell
cd C:\Insider
```

## Adım 1 — `.env` oluşturun ve doldurun

```powershell
Copy-Item .env.ornek .env
notepad .env
```

`.env.ornek` içindeki her satırın ne olduğu ayrıntılı yorumlarla açıklanmış.
Özetle doldurmanız gerekenler:

| Değişken | Nasıl üretilir / neye göre seçilir |
|---|---|
| `TENANT` | Küçük harf/rakam/tire, 1-40 karakter, baş/son tire olamaz (`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`). Örn. `musteri-x`. **`pernod`/`pernod-demo`/`fmcg-demo`/`wietnauer` KULLANMAYIN** — bunlar kod içinde önceden tanımlı, kodsuz kurulum ekranı (`/setup`) hiç açılmaz. |
| `JWT_SECRET` | `-join ((48..57)+(65..90)+(97..122)\|Get-Random -Count 40\|%{[char]$_})` |
| `CONFIG_ENC_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (tam 64 hane hex çıkmalı) |
| `SETUP_TOKEN` | Yukarıdaki `JWT_SECRET` komutunun aynısıyla ayrı bir değer üretin (en az 32 bayt). **Kurulum bitince silinecek** (Adım 6). |
| `API_PORT`/`PORT` | Varsayılanlar (4300/4200) genelde boştur — önce doğrulayın: `netsh interface ipv4 show excludedportrange protocol=tcp`. Listede varsa `.env`'de başka bir port seçin. |
| `COOKIE_INSECURE` | Sunucuya düz HTTP ile (TLS yok) erişiyorsanız `1` bırakın. Önüne HTTPS reverse-proxy koyarsanız `0` yapın. |
| `DASHBOARD_ALLOWED_ORIGINS` | Sadece IIS/nginx reverse-proxy kullanıyorsanız doldurun (bkz. `.env.ornek` yorumu + `deploy/iis-web.config` örneği). Doğrudan `http://<sunucu>:<PORT>` ile erişimde BOŞ bırakın. |

## Adım 2 — Kurulum script'ini çalıştırın

```powershell
powershell -ExecutionPolicy Bypass -File .\kur.ps1
```

Bu, Node sürümünü kontrol eder, kökte `npm install` çalıştırır (workspaces:
`apps/*`, `packages/*`), `pm2`'yi global kurar ve **dashboard build'ini
atlar** (paket önceden build edilmiş geldiği için — bkz. yukarıdaki kanıt
bölümü). `.next` bir sebeple bu makinede çalışmazsa:

```powershell
powershell -ExecutionPolicy Bypass -File .\kur.ps1 -ZorlaBuild
```

ile müşteri makinesinde sıfırdan build tetiklenir (bu, "Windows'ta build
gerekirse" için hazır tutulan kurtarma yoludur).

## Adım 3 — Başlatın

```powershell
powershell -ExecutionPolicy Bypass -File .\baslat.ps1
```

Bu, `pm2` ile `insider-api` + `insider-dashboard` süreçlerini başlatır,
`pm2 save` ile pm2'nin kendi başlatma listesine kaydeder ve tarayıcıyı
`http://localhost:<PORT>/setup` adresinde açar.

## Adım 4 — Tarayıcıda `/setup`: DB bağlantısı + tenant kimliği

Açılan ekranda:

1. **"Kurulum Token'ı"** kutusuna `.env`'deki `SETUP_TOKEN` değerini yapıştırın.
2. **Adım 1 — DB Bağlantısı**: MSSQL sunucu adresi/veritabanı/kullanıcı/parola
   girin, **önce "Test Et"**, başarılıysa **"Kaydet"**. (Parola bir daha
   ekranda gösterilmez, şifreli saklanır.)
   - **IP-host / TLS uyarısı (aşağıda ayrıntılı):** sunucu adresi bir IP ve
     sertifika hostname'e özelse test başarısız olabilir — "Sorun Giderme"
     bölümüne bakın.
3. **Adım 2 — Tenant Kimliği**: görünen ad, sektör (Alkol/FMCG), stratejik
   markalar, UI metinleri, vergi profili. `id` alanı YOK — sunucu bunu
   `.env`'deki `TENANT` değerinden otomatik alır.
4. Her iki adım da kaydedilince "Kurulum tamam" görünür → **Giriş yap**.

## Adım 5 — `/admin/konfigurator`: müşteri/ürün/bölge kırılımı

Giriş yaptıktan sonra `http://localhost:<PORT>/admin/konfigurator` adresine
gidin ve müşteri/ürün/bölge (breakdown) kırılımlarını seçip **önizleyip**
**kaydedin**. Bu adım, dashboard'un hangi kolonları müşteri/ürün/bölge olarak
okuyacağını belirler (Univera şeması müşteriye göre küçük farklılıklar
gösterebilir).

## Adım 6 — Veriyi Yenile

Kırılımları kaydettikten sonra `/admin` sayfasındaki **"Veriyi Yenile"**
butonuna basın — bu, kaydedilen yeni kırılımla mevcut cache/snapshot'ları
tazeler (aksi halde dashboard eski kırılımı gösterebilir, ekrandaki uyarı
mesajları bunu zaten hatırlatır).

## Adım 7 — Kurulum sonrası: `SETUP_TOKEN`'ı kapatın

```powershell
notepad .env
# SETUP_TOKEN= satırını SİLİN veya boş bırakın, kaydedin.
powershell -ExecutionPolicy Bypass -File .\yeniden-baslat.ps1
```

**Önemli — otomatik kapanmayan durum:** `/setup` DB adımını KULLANMAYIP
`.env`'deki `MSSQL_*`/`<TENANT>_MSSQL_*` yedek yolunu (IP-host/TLS sorunu
nedeniyle) tercih ettiyseniz, şifreli DB-credential store'a hiçbir zaman
parola yazılmaz — kurulum motoru bunu "tamamlanmadı" sayar ve `SETUP_TOKEN`'ı
**kendiliğinden asla kapatmaz**. Bu durumda yukarıdaki `SETUP_TOKEN` silme +
yeniden başlatma adımını **MUTLAKA elle** yapın (aksi halde `/setup` uçları
süresiz açık kalır).

## Günlük operasyon

```powershell
powershell -ExecutionPolicy Bypass -File .\durdur.ps1           # durdur
powershell -ExecutionPolicy Bypass -File .\baslat.ps1            # başlat (tarayıcı açar)
powershell -ExecutionPolicy Bypass -File .\yeniden-baslat.ps1    # .env değişikliği sonrası (tarayıcı açmaz)
pm2 logs                                                          # canlı loglar
pm2 status                                                        # süreç durumu
```

Sunucu yeniden başladığında pm2'nin uygulamaları otomatik ayağa kaldırması
için (bu paket bunu OTOMATİK yapmaz — Windows'ta pm2'nin `pm2 startup`
eşdeğeri ek bir Windows-servis aracı gerektirir, bkz. `pm2-windows-startup`
veya NSSM): bu adım kasıtlı olarak bu pakete dahil EDİLMEDİ (doğrulanmamış
üçüncü-parti araç riski) — istenirse ayrı bir talep olarak ele alınabilir.

## Sorun Giderme

### `npm install` hatası (better-sqlite3 / node-gyp)

`better-sqlite3` önce Windows x64 için hazır bir ikili (prebuild) indirmeyi
dener; bulamazsa **Visual Studio Build Tools + Python** ile yerel derlemeye
(`node-gyp rebuild`) düşer. Node 22 LTS kullanıyorsanız normalde hazır ikili
bulunur. Yine de hata alırsanız:

- Node sürümünün tam olarak **22.x LTS** olduğunu doğrulayın (`node -v`).
- İnternet/proxy erişimini kontrol edin (`npm config get registry`).
- Son çare: "Visual Studio Build Tools" (C++ workload) + Python 3 kurup
  `npm install`'i tekrar çalıştırın.

`mssql` paketi (tedious sürücüsü) **saf JavaScript'tir** — bu adımda hiçbir
derleme gerektirmez, yalnız `better-sqlite3` risklidir.

### Port EACCES / "listen EACCES" / "address already in use"

Windows bazı TCP port aralıklarını Hyper-V/WSL için ayırır — bu portlarda
`bind` denemesi, port fiilen boş görünse bile başarısız olabilir:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

Çıktıdaki aralıklarla `.env`'deki `API_PORT`/`PORT` çakışıyorsa değerleri
değiştirip `.\yeniden-baslat.ps1` çalıştırın.

### DB bağlantısı: sunucu adresi bir IP (TLS/sertifika hatası)

`/setup` formu (ve admin konfigüratördeki eşdeğeri) **port'u her zaman 1433**
alır ve **`encrypt=true` + `trustServerCertificate=false`** (üretimde) ile
bağlanır — bu iki ayar bugünkü formdan **DEĞİŞTİRİLEMEZ** (kod: `packages/
core/src/tenant/db-connection-config.ts`, `DbConnectionInput` şeması kasıtlı
dar: yalnız server/database/user/password). Sunucu adresiniz bir **IP** ve
MSSQL kendinden-imzalı veya hostname'e özel bir sertifika sunuyorsa, bağlantı
sertifika doğrulaması yüzünden **başarısız** olur (test butonu "başarısız"
döner; ham hata mesajı güvenlik gereği hiçbir zaman ekrana yansımaz, yalnız
sunucu tarafındaki `pm2 logs` çıktısında görünür).

**Bunu doğrulayamadım** (gerçek bir IP-host MSSQL'e karşı test etmedim) ama
kod okumasından net: bu, formun bugünkü dar şemasının bir sınırıdır.

**Geçici çözüm — `.env` üzerinden yedek yol:**

1. `/setup` ekranında **DB Bağlantısı adımını kaydetmeyin** (boş bırakın).
2. `/setup` ekranında **Tenant Kimliği** adımını yine de kaydedin (bu,
   `isTenantFullyMissing()`'i kapatır — dashboard'a erişim açılır).
3. `.env`'e aşağıdaki önekle MSSQL değişkenlerini ekleyin — önek, `TENANT`
   değerinizin BÜYÜK harfi + tire yerine alt çizgi + `_MSSQL_`:
   - `TENANT=musteri-x` → önek `MUSTERI_X_MSSQL_`
   ```
   MUSTERI_X_MSSQL_SERVER=10.0.0.5
   MUSTERI_X_MSSQL_PORT=1433
   MUSTERI_X_MSSQL_DATABASE=Panorama
   MUSTERI_X_MSSQL_USER=insider_ro
   MUSTERI_X_MSSQL_PASSWORD=...
   MUSTERI_X_MSSQL_ENCRYPT=false
   MUSTERI_X_MSSQL_TRUST_SERVER_CERT=true
   ```
4. `.\yeniden-baslat.ps1` çalıştırın.
5. **`SETUP_TOKEN`'ı elle kapatmayı unutmayın** (yukarıdaki "otomatik
   kapanmayan durum" notuna bakın — bu yolda kendiliğinden kapanmaz).

En sağlıklı çözüm elbette MSSQL'e bir **hostname** üzerinden erişebilmek
(DNS/hosts dosyası) ve sertifikayı o hostname için doğrulatmaktır — mümkünse
bunu tercih edin.

### "Invalid Server Actions request" hatası

Dashboard'u bir **reverse-proxy** (IIS/nginx) arkasında sunuyorsanız ve
tarayıcının gördüğü adres (`Origin`) Next sürecinin kendi `Host`'undan
farklıysa bu hata çıkar. `.env`'de `DASHBOARD_ALLOWED_ORIGINS` değişkenini
proxy'nin dışa açık adresiyle doldurup yeniden başlatın (örnek IIS config:
`deploy/iis-web.config` — port numaralarını kendi `.env`'inize göre
düzenlemeniz gerekir). **Doğrudan** `http://<sunucu-ip>:<PORT>` ile
erişiyorsanız (proxy yok) bu değişken gerekmez.

### Boot'ta loglarda "DB bağlantı hatası" görüyorum

`/setup` ile DB henüz kaydedilmeden önce API, açılıştan ~10 saniye sonra bir
kez otomatik veri-tazeleme dener (`SKIP_STARTUP_WARM` açıklamasına bakın) —
DB henüz yoksa bu **tek seferlik, zararsız** bir hata logudur. DB
kaydedildikten sonra bir daha görünmez (gece 03:00'te ve manuel "Veriyi
Yenile"de tekrar çalışır, o zaman DB zaten hazırdır).

### Uzaktan (başka bilgisayardan) erişilemiyor

Windows Güvenlik Duvarı varsayılan olarak gelen bağlantıları engeller.
`PORT` için bir gelen kuralı açmanız gerekebilir:

```powershell
New-NetFirewallRule -DisplayName "Insider Dashboard" -Direction Inbound -Protocol TCP -LocalPort 4200 -Action Allow
```

(Port numarasını `.env`'deki `PORT` değerinizle değiştirin.)

## Bu kılavuzda doğrulayamadığım noktalar (özet)

- Hiçbir script/adım gerçek bir **Windows** makinesinde çalıştırılmadı —
  yalnızca kod okunarak ve macOS'ta `next build` çıktısı incelenerek
  hazırlandı.
- macOS'ta build edilen `.next`'in Windows'ta `next start` ile sorunsuz
  çalışacağı **varsayımdır** (tasarımdan/dokümantasyondan makul, ama
  denenmedi) — `kur.ps1 -ZorlaBuild` bu riske karşı kurtarma yoludur.
- Gerçek bir **IP-host + kendinden-imzalı sertifika** MSSQL'e karşı
  `/setup` testinin tam olarak hangi hata mesajını üreteceği denenmedi —
  yalnızca kod okumasından (`encrypt=true`, `trustServerCertificate=false`
  üretimde, form alanları bunları değiştiremiyor) çıkarım yapıldı.
- `better-sqlite3`'ün Node 22 LTS + Windows x64 için hazır ikili
  bulunduğunu (node-gyp'e düşmeyeceğini) doğrulamadım — genel bilgiye göre
  Node LTS sürümleri için prebuild mevcuttur, ama bu spesifik sürüm
  kombinasyonunu test etmedim.
- pm2'nin Windows'ta sunucu yeniden başladığında OTOMATİK ayağa kalkması bu
  pakete DAHİL EDİLMEDİ (üçüncü-parti araç gerektirir, doğrulanmamış) —
  şimdilik manuel `.\baslat.ps1` gerekir.
