#!/usr/bin/env node
/**
 * Insider Kurulum Kiti - paketle.mjs
 * ====================================
 * macOS/Linux gelistirme makinesinde CALISTIRILIR (musteri makinesinde
 * DEGIL) - repo'dan surukle-birak kurulabilir bir zip uretir.
 *
 * Ne yapar:
 *   1. apps/dashboard'i TENANT-AGNOSTIK bir yer-tutucu id ile build eder
 *      (bkz. asagidaki "Neden bu ID?" notu) - kur.ps1'deki ayni karar,
 *      BIREBIR ayni id: "kurulum-oncesi-yer-tutucu".
 *   2. Repo'yu bir gecici staging klasorune KOPYALAR - ASAGIDAKI HARIC-TUTMA
 *      LISTESINDEKI her sey ATLANIR (bkz. EXCLUDE_PATTERNS).
 *   3. Taze build edilen apps/dashboard/.next'i staging'e GERI KOYAR (ana
 *      kopyalama .next'i disladigi icin).
 *   4. deploy/paket/ altindaki kurulum script'lerini (kur.ps1, baslat.ps1,
 *      durdur.ps1, yeniden-baslat.ps1, .env.ornek, ecosystem.musteri.config.cjs,
 *      KURULUM.md) staging'in KOK klasorune kopyalar (deploy/paket/ ALT
 *      klasoru olarak DEGIL - musteri zip'i actiginda bunlari apps/,
 *      package.json ile AYNI seviyede gormeli).
 *   5. Staging klasorunu zip'ler -> dist-paket/insider-kurulum-<tarih>.zip
 *
 * node_modules KASITLI OLARAK pakete GIRMEZ (better-sqlite3 platforma ozel -
 * musteri Windows'unda kur.ps1 kendi `npm install`'ini calistirir).
 *
 * Kullanim:
 *   node deploy/paket/paketle.mjs                # build + paketle (varsayilan)
 *   node deploy/paket/paketle.mjs --no-build      # mevcut apps/dashboard/.next'i kullan
 *   node deploy/paket/paketle.mjs --keep-stage    # staging klasorunu SILME (debug)
 */

import { existsSync, mkdirSync, rmSync, cpSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PAKET_DIR = __dirname; // deploy/paket
const DASHBOARD_DIR = path.join(REPO_ROOT, "apps", "dashboard");

// Build-time TENANT - REGISTRY'de OLMAYAN, hicbir tenant-definition dosyasi
// olmayan bilincli bir yer-tutucu. `packages/core/src/tenant/index.ts`
// `isTenantFullyMissing()` bu id icin DAIMA true doner -> `apps/dashboard/
// app/layout.tsx` kok layout'u HER route icin `headers()` cagirir -> Next
// route tablosundaki TUM sayfalar dinamik ("f") isaretlenir, HICBIRI statik
// olarak onceden-render edilmez. Bu, DOGRULANMIS bir bulgudur (bkz.
// KURULUM.md "Neden onceden build?"): TENANT hic verilmeden (varsayilan
// "pernod"a duser, REGISTRY-yonetimli) build edildiginde bazi sayfalar
// STATIK ("o") cikar ve pernod'a ozel icerik build-zamaninda GOMULEBILIR -
// bu yuzden placeholder id ZORUNLU, "TENANT'i hic set etmeden build et"
// GUVENLI DEGILDIR.
const BUILD_PLACEHOLDER_TENANT = "kurulum-oncesi-yer-tutucu";

const args = new Set(process.argv.slice(2));
const shouldBuild = !args.has("--no-build");
const keepStage = args.has("--keep-stage");

function log(msg) {
  console.log(`[paketle] ${msg}`);
}

function fail(msg) {
  console.error(`[paketle] HATA: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) Dashboard build (tenant-agnostik yer-tutucu ile)
// ---------------------------------------------------------------------------
if (shouldBuild) {
  log(`Dashboard build ediliyor (TENANT=${BUILD_PLACEHOLDER_TENANT}) ...`);
  rmSync(path.join(DASHBOARD_DIR, ".next"), { recursive: true, force: true });
  const res = spawnSync("npm", ["run", "build"], {
    cwd: DASHBOARD_DIR,
    env: { ...process.env, NODE_ENV: "production", TENANT: BUILD_PLACEHOLDER_TENANT },
    stdio: "inherit",
  });
  if (res.status !== 0) fail("apps/dashboard build basarisiz - yukaridaki cikisi kontrol edin.");

  // Kanit kontrolu: build ciktisinda hicbir route STATIK ("o") olmamali -
  // varsa (Next surumu/route yapisi degismis olabilir) uyar, dur DEMIYORUZ
  // (paket yine de kullanilabilir olabilir) ama operator'u UYAR.
  log("Not: build ciktisindaki route tablosunu (yukarida) kontrol edin - TUM satirlar");
  log('     "f" (dinamik) olmali. Bir "o" (statik) satiri gorurseniz KURULUM.md');
  log('     "Neden onceden build?" bolumundeki varsayim gecersiz olmus olabilir -');
  log("     bu durumda musteri makinesinde build'e (kur.ps1 -ZorlaBuild) gecin.");
} else {
  if (!existsSync(path.join(DASHBOARD_DIR, ".next"))) {
    fail("--no-build verildi ama apps/dashboard/.next yok - once build edin.");
  }
  log("--no-build: mevcut apps/dashboard/.next kullanilacak (YENIDEN BUILD EDILMEDI).");
}

// ---------------------------------------------------------------------------
// 2) Staging klasoru + haric-tutma listesi
// ---------------------------------------------------------------------------
const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const stageRoot = path.join(os.tmpdir(), `insider-paket-stage-${Date.now()}`);
mkdirSync(stageRoot, { recursive: true });
log(`Staging klasoru: ${stageRoot}`);

// Repo-kok GORELI (relative) yola gore eslesen desenler - herhangi bir
// segment tam eslesirse (klasor adi) VEYA dosya adi deseniyle eslesirse
// haric tutulur. Basit/okunabilir tutmak icin regex yerine kucuk yardimcilar.
const EXCLUDE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".claude",
  "scratchpad",
  "tmp",
  "reports", // kok "reports/" - guvenlik denetim raporlari, ASLA musteriye gitmez (.gitignore ile ayni gerekce)
  ".vscode",
  ".idea",
  "dist-paket", // onceki paketleme ciktilari kendini paketlemesin
]);

// Tam GORELI yol (repo-koke gore, "/" ayiricili) ile eslesen dosya/klasorler.
const EXCLUDE_EXACT_RELATIVE = new Set([
  ".env",
  "data/config-audit.log",
]);

// Dosya adi SONEKI/deseni ile haric tutulanlar (herhangi bir klasorde).
function isExcludedByName(name) {
  if (name === ".DS_Store") return true;
  if (name.endsWith(".log")) return true;
  if (/^\.env(\..+)?$/.test(name) && name !== ".env.ornek") return true; // .env, .env.local, .env.*.local (ama .env.ornek KALSIN degil - zaten deploy/paket'ten geliyor, kok kopyasinda yok)
  if (/^data-.*\.sqlite(-shm|-wal)?$/.test(name)) return false; // (kullanilmiyor, netlik icin birakildi)
  return false;
}

// data/ altindaki musteri/tenant'a ozel runtime durumu - regenerable veya
// baska bir musterinin verisi, YENI musteri kutusuna ASLA gitmemeli.
function isExcludedDataFile(relPath) {
  const rel = relPath.replace(/\\/g, "/");
  if (!rel.startsWith("data/")) return false;
  const base = path.basename(rel);
  if (/\.sqlite(-shm|-wal)?$/.test(base)) return true; // local/wietnauer/fmcg-demo mirror'lari
  if (/^tenant-config\..*\.enc\.json$/.test(base)) return true; // sifreli DB-cred store
  if (/^tenant-def\..*\.json$/.test(base)) return true; // baska ortamin tenant kimligi
  if (/^perms\..*\.json$/.test(base)) return true; // baska musterinin dist/city izin override'i
  if (base === "schema-v2.json" || base === "schema-v2.enriched.json") return true; // dev-makine introspeksiyonu, regenerable
  if (rel.startsWith("data/vectors/")) return true;
  if (rel.startsWith("data/reports/")) return true;
  return false;
}

function shouldExclude(srcPath) {
  const rel = path.relative(REPO_ROOT, srcPath);
  if (rel === "" || rel.startsWith("..")) return false; // REPO_ROOT'un kendisi
  const relPosix = rel.replace(/\\/g, "/");
  if (EXCLUDE_EXACT_RELATIVE.has(relPosix)) return true;
  // deploy/paket/* KAYNAK dosyalari genel kopyalamada ATLANIR - Adim 4'te
  // AYRICA (flatten edilerek, staging KOKUNE) kopyalanacak. Aksi halde zip
  // hem kok seviyesinde hem de deploy/paket/ altinda ayni dosyalarin
  // KAFA KARISTIRICI bir kopyasini barindirir.
  if (relPosix === "deploy/paket" || relPosix.startsWith("deploy/paket/")) return true;

  const segments = relPosix.split("/");
  for (const seg of segments) {
    if (EXCLUDE_DIR_NAMES.has(seg)) return true;
  }
  const base = segments[segments.length - 1];
  if (isExcludedByName(base)) return true;
  if (isExcludedDataFile(relPosix)) return true;
  return false;
}

log("Repo kopyalaniyor (haric-tutma listesi uygulanarak) ...");
cpSync(REPO_ROOT, stageRoot, {
  recursive: true,
  dereference: true,
  filter: (src) => !shouldExclude(src),
});

// ---------------------------------------------------------------------------
// 3) Taze build edilmis .next'i geri koy (ana kopyalama disladi)
// ---------------------------------------------------------------------------
const builtNext = path.join(DASHBOARD_DIR, ".next");
if (!existsSync(builtNext)) {
  fail(`apps/dashboard/.next bulunamadi (${builtNext}) - build basarisiz olmus olabilir.`);
}
log("Build edilmis apps/dashboard/.next staging'e kopyalaniyor ...");
cpSync(builtNext, path.join(stageRoot, "apps", "dashboard", ".next"), { recursive: true });

// ---------------------------------------------------------------------------
// 4) Kurulum script'lerini staging KOKUNE kopyala (deploy/paket/ altina DEGIL)
// ---------------------------------------------------------------------------
const KIT_FILES = [
  "kur.ps1",
  "baslat.ps1",
  "durdur.ps1",
  "yeniden-baslat.ps1",
  ".env.ornek",
  "ecosystem.musteri.config.cjs",
  "KURULUM.md",
];
log("Kurulum script'leri staging kokune kopyalaniyor ...");
for (const f of KIT_FILES) {
  const src = path.join(PAKET_DIR, f);
  if (!existsSync(src)) fail(`Beklenen kurulum dosyasi yok: ${src}`);
  cpSync(src, path.join(stageRoot, f));
}

// ---------------------------------------------------------------------------
// 5) Zip'le
// ---------------------------------------------------------------------------
const outDir = path.join(REPO_ROOT, "dist-paket");
mkdirSync(outDir, { recursive: true });
const outZip = path.join(outDir, `insider-kurulum-${timestamp}.zip`);
rmSync(outZip, { force: true });

log(`Zip uretiliyor: ${outZip}`);
const zipRes = spawnSync("zip", ["-r", "-X", "-q", outZip, "."], { cwd: stageRoot, stdio: "inherit" });
if (zipRes.status !== 0) fail("zip komutu basarisiz (macOS'ta yerlesik 'zip' bekleniyor).");

const sizeMb = (statSync(outZip).size / 1024 / 1024).toFixed(1);
log(`Tamam: ${outZip} (${sizeMb} MB)`);

// ---------------------------------------------------------------------------
// 6) Temizlik
// ---------------------------------------------------------------------------
if (keepStage) {
  log(`--keep-stage verildi - staging klasoru SILINMEDI: ${stageRoot}`);
} else {
  rmSync(stageRoot, { recursive: true, force: true });
  log("Staging klasoru temizlendi.");
}

log("Bitti. Zip icerigini bir kez kontrol edin (ozellikle .env/*.sqlite/*.enc.json OLMAMALI):");
log(`  unzip -l "${outZip}" | grep -iE "\\.env$|\\.sqlite|\\.enc\\.json"  # BOS donmeli`);
