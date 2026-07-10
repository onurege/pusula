// PM2 process yöneticisi — Enroute Pusula (API + Dashboard).
// Kullanım:  pm2 start ecosystem.config.cjs  →  pm2 save
//
// NOT (Windows): PM2'ye "npm" verilmez — Windows'ta npm.cmd'yi node'a JS
// olarak geçirir ve patlar (Unexpected token ':'). Bu yüzden doğrudan node
// entry'leri kullanılır:
//   - API:       node <tsx/cli.mjs> apps/api/src/server.ts
//   - Dashboard: node <next/bin/next> start   (önce: next build)
//
// Mimari (IIS reverse proxy):
//   Browser → IIS (9090) → Next dashboard (127.0.0.1:3000)
//                                   → Hono API (127.0.0.1:8080) → MSSQL
//
// ÖNKOŞUL:  cd apps/dashboard && npm run build
// ÖNKOŞUL:  repo-kök .env → NODE_ENV=production, TENANT=wietnauer,
//           JWT_SECRET, (UNIVERA_PW_KEY ya da ALLOW_DEMO_AUTH=1), W_MSSQL_*

const path = require("node:path");
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: "enroute-api",
      // tsx CLI'yi node ile çalıştır (npm shim'i yok) — Windows-güvenilir.
      script: path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      args: "apps/api/src/server.ts",
      interpreter: "node",
      cwd: ROOT,
      env: {
        NODE_ENV: "production",
        TENANT: "wietnauer",
        API_PORT: "8080",
        API_HOST: "127.0.0.1",
        MSSQL_READ_UNCOMMITTED: "1",
        // JWT_SECRET / UNIVERA_PW_KEY / W_MSSQL_* → repo-kök .env'den yüklenir
      },
      max_memory_restart: "600M",
      autorestart: true,
      time: true,
      kill_timeout: 8000,
    },
    {
      name: "enroute-dashboard",
      // Next binary'sini node ile çalıştır. cwd apps/dashboard (build + config
      // orada), script kök node_modules'teki next (monorepo hoist).
      script: path.join(ROOT, "node_modules", "next", "dist", "bin", "next"),
      args: "start",
      interpreter: "node",
      cwd: path.join(ROOT, "apps", "dashboard"),
      env: {
        NODE_ENV: "production",
        TENANT: "wietnauer",
        ENROUTE_API_URL: "http://127.0.0.1:8080",
        PORT: "3000",
        // IIS 9090'ı HTTP (SSL yok) proxy'liyor → Secure cookie tarayıcıda
        // saklanmaz, login döngüye girer. HTTPS ekleyince bunu kaldır.
        COOKIE_INSECURE: "1",
      },
      max_memory_restart: "800M",
      autorestart: true,
      time: true,
    },
  ],
};
