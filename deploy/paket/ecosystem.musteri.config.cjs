// PM2 process yoneticisi - Insider MUSTERI kurulumu (kodsuz onboarding,
// gercek MSSQL + gercek Univera auth. DEMO_LOGIN YOK.)
//
// Bu dosya paketin KOK klasorune (apps/, package.json ile AYNI yere) kopyalanir
// - `ecosystem.demo.config.cjs`/`ecosystem.pernod.config.cjs` (kod tabanindaki
// ornekler) TENANT'i SABIT (literal) yazar; bu dosya ise TENANT/portlari
// `.env`'den (dotenv ile) okur - cunku bu paket HER musteri icin AYNI kalir,
// musteriye ozel deger tek yerde (.env) tutulur, bu cjs dosyasina DOKUNULMAZ.
//
// Kullanim:  pm2 start ecosystem.musteri.config.cjs   ->   pm2 save
// (Normalde dogrudan degil, baslat.ps1/yeniden-baslat.ps1 uzerinden cagrilir.)
//
// Mimari (dogrudan IP/hostname, proxy YOK): Tarayici -> Next (:PORT) -> API
// (127.0.0.1:API_PORT). API disariya HIC acilmaz (API_HOST=127.0.0.1).
//
// Zorunlu .env alanlari: TENANT, JWT_SECRET, CONFIG_ENC_KEY (yoksa asagida
// ACIK bir hata ile pm2 baslamadan durur - "belirsizlikte fail-closed",
// sessizce yanlis/bos degerle ayaga kalkmak yerine).

const path = require("node:path");
const { config: loadDotenv } = require("dotenv");

const ROOT = __dirname;
loadDotenv({ path: path.join(ROOT, ".env") });

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(
      `[ecosystem.musteri] Zorunlu env eksik: "${name}" - "${path.join(ROOT, ".env")}" dosyasina ekleyin ` +
        `(bkz. .env.ornek). Kurulum tamamlanmadan pm2 baslatilmaz (fail-fast).`,
    );
  }
  return v;
}

function optional(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

const TENANT = required("TENANT");
const JWT_SECRET = required("JWT_SECRET");
const CONFIG_ENC_KEY = required("CONFIG_ENC_KEY");

const API_PORT = optional("API_PORT", "4300");
const API_HOST = optional("API_HOST", "127.0.0.1");
const PORT = optional("PORT", "4200");
const ENROUTE_API_URL = optional("ENROUTE_API_URL", `http://127.0.0.1:${API_PORT}`);
const COOKIE_INSECURE = optional("COOKIE_INSECURE", "1");
const DASHBOARD_ALLOWED_ORIGINS = optional("DASHBOARD_ALLOWED_ORIGINS", "");
// Bos ise setup-mode.ts fail-closed davranir (SETUP_TOKEN yok sayilir) -
// bu, kurulum SONRASI (SETUP_TOKEN .env'den silindiginde) istenen davranistir.
const SETUP_TOKEN = optional("SETUP_TOKEN", "");
const SKIP_STARTUP_WARM = optional("SKIP_STARTUP_WARM", "");
// Admin ekranlarina erisebilecek kullanicilar (bos ise API varsayilani
// "ERCYONETICI"). API env.ts bunu okur; acikca gecirmek pm2 inheritance
// belirsizligini ortadan kaldirir (bkz. .env.ornek ADMIN_USERS).
const ADMIN_USERS = optional("ADMIN_USERS", "");

module.exports = {
  apps: [
    {
      name: "insider-api",
      script: path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      args: "apps/api/src/server.ts",
      interpreter: "node",
      cwd: ROOT,
      env: {
        NODE_ENV: "production",
        TENANT,
        API_PORT,
        API_HOST,
        JWT_SECRET,
        CONFIG_ENC_KEY,
        SETUP_TOKEN,
        SKIP_STARTUP_WARM,
        ADMIN_USERS,
        // MSSQL_* / <TENANT>_MSSQL_* yedek-yol degiskenleri de .env'de
        // tanimliysa loadDotenv() zaten process.env'e yazdi - api/src/env.ts
        // ayrica repo-kok .env'i kendi de yukler (cift-yukleme zararsiz,
        // dotenv ilk-bulan-kazanir kuralinda ayni degerler ustune yazmaz).
      },
      max_memory_restart: "800M",
      autorestart: true,
      time: true,
      kill_timeout: 8000,
    },
    {
      name: "insider-dashboard",
      script: path.join(ROOT, "node_modules", "next", "dist", "bin", "next"),
      args: "start",
      interpreter: "node",
      cwd: path.join(ROOT, "apps", "dashboard"),
      env: {
        NODE_ENV: "production",
        TENANT,
        ENROUTE_API_URL,
        PORT,
        COOKIE_INSECURE,
        DASHBOARD_ALLOWED_ORIGINS,
      },
      max_memory_restart: "1000M",
      autorestart: true,
      time: true,
    },
  ],
};
