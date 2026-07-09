// PM2 process yöneticisi — Enroute Pusula (API + Dashboard).
// Kullanım:  pm2 start ecosystem.config.cjs  →  pm2 save  →  pm2 startup
//
// Mimari (IIS reverse proxy ile):
//   Browser (HTTPS) → IIS (443, TLS termination + ARR reverse proxy)
//                       → Next dashboard (127.0.0.1:3000)
//                           → (sunucu-taraflı) Hono API (127.0.0.1:8080)
//                               → MSSQL (Univera, VPN)
//   IIS YALNIZCA dashboard'a (3000) proxy yapar. API dış ağa AÇILMAZ
//   (127.0.0.1 bind — GUV-03). Dashboard API'yi localhost'tan çağırır.
//
// ÖNKOŞUL:  cd apps/dashboard && npm run build   (next start için gerekli)
// ÖNKOŞUL:  repo-kök .env'de → JWT_SECRET (32+ rastgele), UNIVERA_PW_KEY,
//           W_MSSQL_* (VPN), TENANT. NODE_ENV=production iken bunlar yoksa
//           API boot'ta fail-fast eder (GUV-01/02 — bilinçli).

const path = require("node:path");
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: "enroute-api",
      cwd: ROOT,
      script: "npm",
      args: "run api:start",              // tsx apps/api/src/server.ts
      env: {
        NODE_ENV: "production",           // ← TÜM sertleştirmeyi bu aktive eder
        TENANT: "wietnauer",
        API_PORT: "8080",
        API_HOST: "127.0.0.1",            // dış ağa kapalı (GUV-03)
        MSSQL_READ_UNCOMMITTED: "1",      // canlı OLTP'yi bloke etme (VYK-04)
        // JWT_SECRET / UNIVERA_PW_KEY / W_MSSQL_* → repo-kök .env'den yüklenir
        // (server.ts açılışta dotenv ile okur). Buraya da yazılabilir.
      },
      max_memory_restart: "600M",
      autorestart: true,
      time: true,                          // log satırlarına zaman damgası
      kill_timeout: 8000,                  // SIGINT sonrası closePool için süre
    },
    {
      name: "enroute-dashboard",
      cwd: path.join(ROOT, "apps", "dashboard"),
      script: "npm",
      args: "run start",                  // next start  (önce: next build)
      env: {
        NODE_ENV: "production",           // next start zaten set eder; açık tutuldu
        TENANT: "wietnauer",
        ENROUTE_API_URL: "http://127.0.0.1:8080",  // API_PORT ile eşleşmeli
        PORT: "3000",
      },
      max_memory_restart: "800M",
      autorestart: true,
      time: true,
    },
  ],
};
