// PM2 process yöneticisi — NORA 4Sight PERNOD (OFFLINE snapshot).
// Kullanım:  pm2 start ecosystem.pernod.config.cjs  →  pm2 save
//
// Bu sunucunun Pernod MSSQL'ine (bulutistan) ağ erişimi YOK. Bu yüzden
// TENANT=pernod-demo: gerçek Pernod verisini CACHE-ONLY servis eder.
//   - Veri: data/local.sqlite — erişimi olan bir makinede senkronlanıp
//     buraya KOPYALANIR (map_customers + v7 komuta snapshot). MSSQL'e gidilmez.
//   - Login: statik demo kullanıcısı (DEMO_LOGIN_USER/PASSWORD) — Pernod'un
//     gerçek MSSQL auth'u bu sunucuda çalışamaz.
//   - Branding: Pernod (pernod-demo config, PERNOD_CONFIG spread'i).
//   - Çalışan ekranlar: Komuta + Harita. Canlı MSSQL isteyenler (risk/ziyaret/
//     raporlar) bu modda boştur.
//
// ÖNKOŞUL:
//   1. data/local.sqlite'ı (gerçek Pernod snapshot'ı) buraya kopyala.
//   2. .env: NODE_ENV=production, JWT_SECRET=<32+ char>. (MSSQL_* gerekmez;
//      varsa da kullanılmaz — demoData MSSQL'e gitmez.)
//   3. cd apps/dashboard && $env:TENANT="pernod-demo" && npm run build
//
// Portlar: dashboard 3300, API 3400 (demo 3100/3200; 8080/8090/9090 rezerve).

const path = require("node:path");
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: "pusula-pernod-api",
      script: path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      args: "apps/api/src/server.ts",
      interpreter: "node",
      cwd: ROOT,
      env: {
        NODE_ENV: "production",
        TENANT: "pernod-demo",
        API_PORT: "3400",
        API_HOST: "127.0.0.1",
        ALLOW_DEMO_AUTH: "1", // MSSQL/UNIVERA_PW_KEY yok — modül init'i geçsin
        // Statik login (MSSQL yok) — auth.ts pernod-demo (demoData) tenant'ında okur.
        DEMO_LOGIN_USER: "pusula@univera.com.tr",
        DEMO_LOGIN_PASSWORD: "pusula123",
        // JWT_SECRET → repo-kök .env'den (login token imzası)
      },
      max_memory_restart: "800M",
      autorestart: true,
      time: true,
      kill_timeout: 8000,
    },
    {
      name: "pusula-pernod-dashboard",
      script: path.join(ROOT, "node_modules", "next", "dist", "bin", "next"),
      args: "start",
      interpreter: "node",
      cwd: path.join(ROOT, "apps", "dashboard"),
      env: {
        NODE_ENV: "production",
        TENANT: "pernod-demo",
        ENROUTE_API_URL: "http://127.0.0.1:3400",
        PORT: "3300",
        COOKIE_INSECURE: "1", // HTTP proxy arkası → Secure cookie olmadan login tutar
      },
      max_memory_restart: "1000M",
      autorestart: true,
      time: true,
    },
  ],
};
