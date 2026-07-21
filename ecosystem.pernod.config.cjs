// PM2 process yöneticisi — Enroute Pusula PERNOD (gerçek Univera verisi).
// Kullanım:  pm2 start ecosystem.pernod.config.cjs  →  pm2 save
//
// Pernod = uygulamanın VARSAYILAN tenant'ı:
//   - MSSQL: MSSQL_* prefix (repo-kök .env) — gerçek Pernod Univera DB'si
//   - SQLite mirror: data/local.sqlite — MSSQL'den senkronlanır (ilk çalıştırmada
//     "Verileri yenile" / map sync ile dolar; gitignore'da, klonla gelmez)
//
// ÖNKOŞUL (.env, repo kökü):
//   NODE_ENV=production
//   TENANT=pernod
//   JWT_SECRET=<32+ karakter rastgele>
//   MSSQL_SERVER=<host\instance>
//   MSSQL_DATABASE=<db adı>
//   MSSQL_USER=<kullanıcı>          # SALT-OKUNUR öneririz (read-only kuralı)
//   MSSQL_PASSWORD=<şifre>
//   MSSQL_PORT=1433
//   MSSQL_ENCRYPT=true
//   MSSQL_TRUST_SERVER_CERT=true    # self-signed cert varsa
//   UNIVERA_PW_KEY=<AES anahtarı>   # gerçek kullanıcı login'i için (yoksa ALLOW_DEMO_AUTH=1)
//
// ÖNKOŞUL: cd apps/dashboard && (TENANT=pernod) npm run build
//
// Portlar bu sunucuya özel seçildi (demo 3100/3200'ü kullanıyor; 8080/8090/9090
// rezerve). Pernod: dashboard 3300, API 3400 — çakışmazsa böyle kalsın.

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
        TENANT: "pernod",
        API_PORT: "3400",
        API_HOST: "127.0.0.1",
        MSSQL_READ_UNCOMMITTED: "1", // saha DB'yi kilitleme (read-only raporlama)
        // MSSQL_* / JWT_SECRET / UNIVERA_PW_KEY → repo-kök .env'den
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
        TENANT: "pernod",
        ENROUTE_API_URL: "http://127.0.0.1:3400",
        PORT: "3300",
        COOKIE_INSECURE: "1", // HTTP-only erişim → Secure cookie olmadan login tutar
      },
      max_memory_restart: "1000M",
      autorestart: true,
      time: true,
    },
  ],
};
