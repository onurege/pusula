<#
  Insider Kurulum Kiti - baslat.ps1
  ===================================
  pm2 ile Insider'i (API + Dashboard) baslatir ve tarayiciyi /setup ekraninda
  acar. Bu paketin KOK klasorunde calistirin (apps/, package.json ile ayni yer).

  Onkosul: .env dosyasi olusturulmus olmali (bkz. .env.ornek + KURULUM.md).

  Kullanim:
    powershell -ExecutionPolicy Bypass -File .\baslat.ps1
#>

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
  Write-Host "HATA: '.env' dosyasi bulunamadi." -ForegroundColor Red
  Write-Host "Once '.env.ornek' dosyasini '.env' olarak kopyalayip degerleri doldurun (KURULUM.md Adim 2)." -ForegroundColor Red
  exit 1
}

# .env'i oku - burada sadece tarayiciyi DOGRU porta acmak icin PORT degerini
# cikariyoruz. Gercek surec ortam degiskenleri ecosystem.musteri.config.cjs
# icinde `dotenv` ile AYRICA (ve otoriter olarak) yuklenir - burasi yalnizca
# kolaylik amacli bir on-okuma.
$envMap = @{}
Get-Content $envPath | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { return }
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $envMap[$Matches[1]] = $Matches[2].Trim()
  }
}

if (-not $envMap.ContainsKey("TENANT") -or $envMap["TENANT"] -eq "") {
  Write-Host "HATA: .env icinde TENANT bos. Once bir TENANT id belirleyin (KURULUM.md Adim 2)." -ForegroundColor Red
  exit 1
}
if (-not $envMap.ContainsKey("JWT_SECRET") -or $envMap["JWT_SECRET"] -eq "") {
  Write-Host "HATA: .env icinde JWT_SECRET bos. Once uretin (KURULUM.md Adim 2)." -ForegroundColor Red
  exit 1
}
if (-not $envMap.ContainsKey("CONFIG_ENC_KEY") -or $envMap["CONFIG_ENC_KEY"] -eq "") {
  Write-Host "HATA: .env icinde CONFIG_ENC_KEY bos. Once uretin (KURULUM.md Adim 2)." -ForegroundColor Red
  exit 1
}

$dashboardPort = if ($envMap.ContainsKey("PORT") -and $envMap["PORT"] -ne "") { $envMap["PORT"] } else { "4200" }

Write-Host "== Insider Baslatiliyor ==" -ForegroundColor Cyan
Write-Host "TENANT       : $($envMap['TENANT'])"
Write-Host "Dashboard    : http://localhost:$dashboardPort"
if ($envMap.ContainsKey("SETUP_TOKEN") -and $envMap["SETUP_TOKEN"] -ne "") {
  Write-Host "Setup modu   : SETUP_TOKEN tanimli (tenant tamamlanmadiysa /setup acik olacak)"
} else {
  Write-Host "Setup modu   : SETUP_TOKEN BOS - eger tenant henuz tamamlanmadiysa /setup 404 doner!" -ForegroundColor Yellow
}
Write-Host ""

pm2 startOrReload ecosystem.musteri.config.cjs
if ($LASTEXITCODE -ne 0) {
  Write-Host "HATA: pm2 baslatilamadi. 'pm2 logs' ile detaya bakin." -ForegroundColor Red
  exit 1
}
pm2 save

Start-Sleep -Seconds 2
pm2 status

$url = "http://localhost:$dashboardPort/setup"
Write-Host "`nTarayici aciliyor: $url" -ForegroundColor Green
Start-Process $url

Write-Host ""
Write-Host "Durdurmak icin        : powershell -ExecutionPolicy Bypass -File .\durdur.ps1"
Write-Host "Yeniden baslatmak icin: powershell -ExecutionPolicy Bypass -File .\yeniden-baslat.ps1"
Write-Host "Canli loglar icin     : pm2 logs"
Write-Host "Surec durumu icin     : pm2 status"
