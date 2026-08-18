// PM2 process yöneticisi — NORA 4Sight DEMO (fmcg-demo tenant).
// Kullanım:  pm2 start ecosystem.demo.config.cjs  →  pm2 save
//
// Bu config AYRI bir demo sunucusu içindir:
//   - Tenant: fmcg-demo (sentetik veri, data/fmcg-demo.sqlite — repo'da commit'li)
//   - MSSQL YOK: demo canlı DB'ye bağlanmaz
//   - LOGIN: statik demo kullanıcısı (DEMO_LOGIN_USER/PASSWORD, MSSQL yok)
//
// ÖNKOŞUL (yeni sunucuda):
//   1. Node 22 LTS
//   2. repo klonu + `npm install` (fmcg-demo.sqlite klonla birlikte gelir)
//   3. Dashboard build'i MUTLAKA açık-erişim flag'i ile:
//        cd apps/dashboard
//        $env:TENANT="fmcg-demo"; npm run build
//   4. repo-kök .env → NODE_ENV=production, JWT_SECRET (dummy 16+ char, açık
//      erişimde kullanılmaz ama modül init'i için gerekli), ALLOW_DEMO_AUTH=1
//
// Mimari (doğrudan IP): Browser → Next (:3100) → API (127.0.0.1:3200)
// Portlar bu sunucuya özel: 8080/8090/9090 rezerve (EACCES), 3000 mevcut uygulamada.

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
        // Bu sunucuda 8080/8090/9090 Windows tarafından rezerve (EACCES),
        // 3000 mevcut uygulamada. Demo API iç port: 3200 (boş + rezerve-dışı).
        API_PORT: "3200",
        API_HOST: "127.0.0.1",
        ALLOW_DEMO_AUTH: "1", // MSSQL/UNIVERA_PW_KEY yok — modül init'i geçsin
        // Statik demo login (MSSQL yok) — auth.ts bunları demoData tenant'ında okur.
        DEMO_LOGIN_USER: "pusula@univera.com.tr",
        DEMO_LOGIN_PASSWORD: "pusula123",
        // JWT_SECRET → repo-kök .env'den (login token imzası)
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
        ENROUTE_API_URL: "http://127.0.0.1:3200", // demo API iç portu
        PORT: "3100", // dışa açılan dashboard portu (3000 mevcut uygulamada)
        COOKIE_INSECURE: "1", // HTTP-only → Secure cookie olmadan login tutar
      },
      max_memory_restart: "800M",
      autorestart: true,
      time: true,
    },
  ],
};
