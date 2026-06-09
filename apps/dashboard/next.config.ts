import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
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
