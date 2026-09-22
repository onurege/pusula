<#
  Insider Kurulum Kiti - yeniden-baslat.ps1
  ============================================
  pm2 uzerinden Insider surecelerini (API + Dashboard) yeniden baslatir.
  Ne zaman kullanilir:
    - .env icinde bir deger degistirdikten sonra (ornegin PORT, SETUP_TOKEN
      silindikten sonra, DASHBOARD_ALLOWED_ORIGINS eklendikten sonra) -
      pm2 surecleri .env'i yalnizca BASLARKEN okur, calisirken CANLI izlemez.
    - Konfigurator'de "Veriyi Yenile" disinda bir sey takilirsa (nadir).

  Bu script tarayici ACMAZ (yalnizca baslat.ps1 acar) - sessiz/otomasyon-dostu
  yeniden baslatma icindir.

  Kullanim:
    powershell -ExecutionPolicy Bypass -File .\yeniden-baslat.ps1
#>

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
  Write-Host "HATA: '.env' dosyasi bulunamadi - once olusturun (KURULUM.md Adim 2)." -ForegroundColor Red
  exit 1
}

Write-Host "Insider yeniden baslatiliyor (pm2 restart, .env TAZE okunur) ..." -ForegroundColor Cyan
pm2 restart ecosystem.musteri.config.cjs --update-env
if ($LASTEXITCODE -ne 0) {
  Write-Host "HATA: pm2 restart basarisiz. 'pm2 logs' ile detaya bakin." -ForegroundColor Red
  exit 1
}
pm2 save
pm2 status
Write-Host "`nYeniden baslatildi."
