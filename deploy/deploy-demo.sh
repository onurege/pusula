#!/bin/bash
# =============================================================================
# Insider FMCG Demo — sunucu deploy (Linux/macOS + PM2)
# Kullanım (sunucuda, repo kökünde):  bash deploy/deploy-demo.sh
#
# Mimari: Browser → Next (:3100) → API (127.0.0.1:3200). SQLite sentetik veri
# (data/fmcg-demo.sqlite repo'da commitli). MSSQL bağlantısı YOK.
# Önkoşul: Node 22 LTS, PM2 global (npm i -g pm2), repo-kök .env (aşağıda kontrol).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "▶ repo: $ROOT"

echo "[1/6] Güncel kodu çek (git pull --ff-only)"
git pull --ff-only

echo "[2/6] Bağımlılıklar (npm install)"
npm install

echo "[3/6] .env kontrol (JWT_SECRET zorunlu)"
if [ ! -f .env ] || ! grep -q "^JWT_SECRET=" .env; then
  echo "  .env'de JWT_SECRET yok — oluşturuluyor (dummy 16+ char; açık login'de imza için)."
  {
    echo "NODE_ENV=production"
    echo "JWT_SECRET=insider-demo-$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
    echo "ALLOW_DEMO_AUTH=1"
  } >> .env
  echo "  .env güncellendi."
else
  echo "  .env / JWT_SECRET mevcut ✓"
fi

echo "[4/6] Dashboard prod build (TENANT=fmcg-demo)"
( cd apps/dashboard && TENANT=fmcg-demo npm run build )

echo "[5/6] PM2 ile (yeniden) başlat"
pm2 startOrReload ecosystem.demo.config.cjs
pm2 save

echo "[6/6] Durum"
pm2 status | grep -E "pusula-demo|name" || true
echo ""
echo "✓ Insider demo ayakta → dashboard http://<sunucu>:3100  (api iç port 3200)"
echo "  Giriş: pusula@univera.com.tr / pusula123"
echo "  Dışa açmak için IIS (deploy/iis-web.config) veya nginx → :3100 reverse-proxy."
