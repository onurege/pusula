import type { NextConfig } from "next";

// Server Actions CSRF koruması: Next, action isteğinin Origin'ini Host ile
// karşılaştırır. IIS reverse proxy arkasında (tarayıcı panorama...:9090,
// Next 127.0.0.1:3000 görür) bunlar uyuşmaz → "Invalid Server Actions request".
// Proxy origin(ler)ini güvenli listeye ekle. DASHBOARD_ALLOWED_ORIGINS env'i
// (virgülle ayrık) ile domain değişince koda dokunmadan güncellenebilir.
const allowedOrigins = (
  process.env.DASHBOARD_ALLOWED_ORIGINS ??
  "panorama.weitnauer.com.tr:9090,panorama.weitnauer.com.tr"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins },
  },
  // Workspace package'i kaynak olarak transpile et. `@enroute/core` TS dosyaları
  // Node ESM konvansiyonuyla `.js` uzantısı kullanıyor (örn. `./agent.js`),
  // tsx bunu doğru çözüyor ama Turbopack default'ta `.js` → `.ts` map'lemiyor.
  // transpilePackages bu paketleri Next bundler'ı içine alır → source-aware
  // resolution çalışır.
  transpilePackages: ["@enroute/core"],
  // Native modüller — Next bundle'ına alma; runtime'da Node require et.
  // `@enroute/core` transpile edilse de bu dep'leri kullanan dosyalar
  // (db.ts, local-db.ts) server-only çalışacak; client tarafında zaten tree-shake
  // edilir (sadece tenant config import ediyoruz). Bu liste server bundle'ı
  // koruyor — turbopack `.node` binary'leri parse etmeye çalışmaz.
  serverExternalPackages: ["better-sqlite3", "mssql"],
};

export default config;
