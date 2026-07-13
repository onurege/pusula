// PM2 process yöneticisi — Enroute Pusula DEMO (fmcg-demo tenant).
// Kullanım:  pm2 start ecosystem.demo.config.cjs  →  pm2 save
//
// Bu config AYRI bir demo sunucusu içindir:
//   - Tenant: fmcg-demo (sentetik veri, data/fmcg-demo.sqlite — repo'da commit'li)
//   - MSSQL YOK: demo canlı DB'ye bağlanmaz
//   - GİRİŞSİZ AÇIK: demoOpenAccess=true → API auth guard bypass, tam merkez scope
//
// ÖNKOŞUL (yeni sunucuda):
//   1. Node 22 LTS
//   2. repo klonu + `npm install` (fmcg-demo.sqlite klonla birlikte gelir)
//   3. Dashboard build'i MUTLAKA açık-erişim flag'i ile:
//        cd apps/dashboard
//        $env:TENANT="fmcg-demo"; $env:NEXT_PUBLIC_OPEN_ACCESS="1"; npm run build
//      (NEXT_PUBLIC_* build zamanında gömülür — runtime'da set etmek yetmez.)
//   4. repo-kök .env → NODE_ENV=production, JWT_SECRET (dummy 16+ char, açık
//      erişimde kullanılmaz ama modül init'i için gerekli), ALLOW_DEMO_AUTH=1
//
// Mimari (IIS reverse proxy): Browser → IIS → Next (127.0.0.1:3000) → API (127.0.0.1:8080)

const path = require("node:path");
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: "pusula-demo-api",
      script: path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      args: "apps/api/src/server.ts",
      interpreter: "node",
      cwd: ROOT,
      env: {
        NODE_ENV: "production",
        TENANT: "fmcg-demo",
        API_PORT: "8080",
        API_HOST: "127.0.0.1",
        ALLOW_DEMO_AUTH: "1", // MSSQL/UNIVERA_PW_KEY yok — modül init'i geçsin
        // JWT_SECRET → repo-kök .env'den (açık erişimde kullanılmaz, init için)
      },
      max_memory_restart: "600M",
      autorestart: true,
      time: true,
      kill_timeout: 8000,
    },
    {
      name: "pusula-demo-dashboard",
      script: path.join(ROOT, "node_modules", "next", "dist", "bin", "next"),
      args: "start",
      interpreter: "node",
      cwd: path.join(ROOT, "apps", "dashboard"),
      env: {
        NODE_ENV: "production",
        TENANT: "fmcg-demo",
        ENROUTE_API_URL: "http://127.0.0.1:8080",
        PORT: "3000",
        NEXT_PUBLIC_OPEN_ACCESS: "1", // runtime fallback (asıl gömme build'de)
        COOKIE_INSECURE: "1", // HTTP-only proxy (login yok ama tutarlılık)
      },
      max_memory_restart: "800M",
      autorestart: true,
      time: true,
    },
  ],
};
