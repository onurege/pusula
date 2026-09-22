<#
  Insider Kurulum Kiti - kur.ps1
  ===============================
  Bu script paketin (zip'ten cikarilmis) KOK klasorunde calistirilir - yani
  apps/, packages/, package.json ile AYNI klasorde (bu dosyanin bulundugu yer).

  Ne yapar:
    1. Node.js surumunu kontrol eder (Node 22 LTS onerilir - uyari verir,
       DURDURMAZ; net bir hata degilse devam eder).
    2. Kok dizinde `npm install` calistirir (npm workspaces: apps/*, packages/*).
       - better-sqlite3 (native modul) bu adimda platforma ozel (win-x64)
         onceden-derlenmis (prebuild) binary indirir - internet gerektirir.
       - mssql/tedious SAF JavaScript'tir, native derleme GEREKMEZ.
    3. pm2'yi GLOBAL kurar (zaten kuruluysa atlar).
    4. Dashboard (Next.js) build adimi VARSAYILAN OLARAK ATLANIR - bu paket
       ONCEDEN BUILD EDILMIS gelir (apps/dashboard/.next pakette mevcut).
       Neden guvenli oldugu KURULUM.md "Neden onceden build?" bolumunde
       KANITLARIYLA (build cikti route tablosu) aciklanmistir: paket, TENANT
       REGISTRY'de olmayan bir yer-tutucu id ile build edildigi icin next'in
       route tablosundaki TUM sayfalar "f" (dinamik, istek-basi render)
       olarak isaretlenir - hicbir sayfaya tenant/marka bilgisi GOMULMEZ.
       `-ZorlaBuild` anahtari ile musteri makinesinde YENIDEN build tetiklenir
       (ornegin .next bozulduysa veya Next surumu bu makinede farkli davraniyorsa
       bir kurtarma yolu olarak).

  Kullanim (PowerShell, yonetici GEREKMEZ ama ExecutionPolicy Bypass gerekir):
    cd C:\Insider              (veya zip'in cikarildigi klasor)
    powershell -ExecutionPolicy Bypass -File .\kur.ps1
    powershell -ExecutionPolicy Bypass -File .\kur.ps1 -ZorlaBuild   # yeniden build
#>

param(
  [switch]$ZorlaBuild
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "== Insider Kurulum ==" -ForegroundColor Cyan
Write-Host "Klasor: $PSScriptRoot`n"

# ---------------------------------------------------------------------------
# 1) Node surumu
# ---------------------------------------------------------------------------
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "HATA: Node.js bulunamadi. Once Node 22 LTS kurun: https://nodejs.org/en/download" -ForegroundColor Red
  Write-Host "Kurulumdan sonra bu terminali kapatip yeniden acin, sonra bu scripti tekrar calistirin." -ForegroundColor Red
  exit 1
}
$nodeVersion = node -v
Write-Host "Node surumu: $nodeVersion"
$major = 0
if ($nodeVersion -match '^v(\d+)\.') { $major = [int]$Matches[1] }
if ($major -lt 22) {
  Write-Host "UYARI: Node $nodeVersion tespit edildi - Node 22 LTS ONERILIR (paket bununla test edildi)." -ForegroundColor Yellow
  Write-Host "        Devam ediliyor, ama 'npm install' asamasinda better-sqlite3 icin uygun bir" -ForegroundColor Yellow
  Write-Host "        onceden-derlenmis binary bulunamazsa (ABI uyumsuzlugu) kurulum hata verebilir." -ForegroundColor Yellow
} else {
  Write-Host "Node surumu uygun." -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 2) Bagimliliklar (kok - npm workspaces)
# ---------------------------------------------------------------------------
Write-Host "`n[1/3] npm install (kok + workspaces: apps/*, packages/*) ..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
  Write-Host "`nHATA: npm install basarisiz oldu." -ForegroundColor Red
  Write-Host "Genelde iki sebepten biridir:" -ForegroundColor Red
  Write-Host "  a) Internet erisimi yok / npm registry'ye ulasilamiyor." -ForegroundColor Red
  Write-Host "  b) better-sqlite3 icin bu Node surumune uygun onceden-derlenmis binary yok ve" -ForegroundColor Red
  Write-Host "     yedek yol (node-gyp) Visual Studio Build Tools + Python istiyor." -ForegroundColor Red
  Write-Host "Detay icin KURULUM.md 'Sorun Giderme' bolumune bakin." -ForegroundColor Red
  exit 1
}
Write-Host "npm install tamam." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3) pm2 (global process yoneticisi)
# ---------------------------------------------------------------------------
Write-Host "`n[2/3] pm2 kontrol ..." -ForegroundColor Cyan
$pm2Cmd = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2Cmd) {
  Write-Host "pm2 bulunamadi - global kuruluyor (npm i -g pm2) ..."
  npm i -g pm2
  if ($LASTEXITCODE -ne 0) {
    Write-Host "HATA: pm2 global kurulumu basarisiz. Elle deneyin: npm i -g pm2" -ForegroundColor Red
    exit 1
  }
  Write-Host "pm2 kuruldu." -ForegroundColor Green
} else {
  Write-Host "pm2 zaten kurulu: $($pm2Cmd.Source)" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 4) Dashboard build - VARSAYILAN: ATLA (paket onceden build edilmis gelir)
# ---------------------------------------------------------------------------
Write-Host "`n[3/3] Dashboard build kontrolu ..." -ForegroundColor Cyan
$dashboardNext = Join-Path $PSScriptRoot "apps\dashboard\.next"
$prebuilt = Test-Path $dashboardNext

function Invoke-DashboardBuild {
  Write-Host "Dashboard build baslatiliyor (TENANT=kurulum-oncesi-yer-tutucu, tenant-agnostik) ..."
  Push-Location (Join-Path $PSScriptRoot "apps\dashboard")
  try {
    $env:TENANT = "kurulum-oncesi-yer-tutucu"
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "next build basarisiz oldu (bkz. yukaridaki hata)." }
  } finally {
    Remove-Item Env:\TENANT -ErrorAction SilentlyContinue
    Pop-Location
  }
}

if ($ZorlaBuild) {
  Write-Host "-ZorlaBuild verildi - onceden-build edilmis .next YOK SAYILIYOR, yeniden build ediliyor." -ForegroundColor Yellow
  Invoke-DashboardBuild
  Write-Host "Yeniden build tamam." -ForegroundColor Green
} elseif ($prebuilt) {
  Write-Host "apps/dashboard/.next MEVCUT - bu paket ONCEDEN BUILD EDILMIS - build ATLANDI." -ForegroundColor DarkGray
  Write-Host "(Gerekirse yeniden build: powershell -ExecutionPolicy Bypass -File .\kur.ps1 -ZorlaBuild)"
} else {
  Write-Host "apps/dashboard/.next bulunamadi - paket onceden build edilmemis gibi gorunuyor, build calistiriliyor ..." -ForegroundColor Yellow
  Invoke-DashboardBuild
  Write-Host "Build tamam." -ForegroundColor Green
}

Write-Host "`n== Kurulum TAMAM ==" -ForegroundColor Green
Write-Host "Sonraki adim:"
Write-Host "  1) '.env.ornek' dosyasini '.env' olarak kopyalayin ve degerleri doldurun (bkz. KURULUM.md Adim 2)."
Write-Host "  2) powershell -ExecutionPolicy Bypass -File .\baslat.ps1"
