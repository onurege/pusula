<#
  Insider Kurulum Kiti - durdur.ps1
  ===================================
  pm2 uzerinden Insider surecelerini (API + Dashboard) durdurur. Sunucu
  yeniden acilsa bile pm2 bu surecleri OTOMATIK baslatmaz (bkz. baslat.ps1 /
  yeniden-baslat.ps1 - "pm2 save" ile pm2'nin kendi otomatik-baslama listesini
  guncelleriz, ama bu script BILINCLI OLARAK durdurulmus durumu da kaydeder).

  Kullanim:
    powershell -ExecutionPolicy Bypass -File .\durdur.ps1
#>

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "Insider durduruluyor (pm2 stop) ..." -ForegroundColor Cyan
pm2 stop ecosystem.musteri.config.cjs
pm2 save
pm2 status
Write-Host "`nDurduruldu. Yeniden baslatmak icin: powershell -ExecutionPolicy Bypass -File .\baslat.ps1"
