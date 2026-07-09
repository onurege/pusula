// .env ÖN-YÜKLEME modülü — server.ts'in İLK import'u olmalı.
//
// Neden ayrı modül: ES modüllerde tüm `import` satırları modül gövdesinden
// ÖNCE (hoisted) çalışır. server.ts gövdesindeki loadDotenv, `@enroute/core`
// import'undan (auth.ts JWT_SECRET'i modül yüklenirken okur) SONRA çalışıyordu
// → env geç yükleniyordu. Bu modül ilk import olduğu için dotenv, diğer tüm
// import'lardan önce çalışır ve process.env hazır olur.
//
// İki kaynak (dotenv override etmez, ilk bulan kazanır):
//   1) REPO_ROOT/.env  (import.meta.url'den)
//   2) process.cwd()/.env  (PM2/Windows tsx yol farkı için sağlam fallback)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
loadDotenv({ path: path.join(repoRoot, ".env") });
loadDotenv({ path: path.join(process.cwd(), ".env") });
