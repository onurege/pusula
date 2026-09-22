// .env ÖN-YÜKLEME — MUTLAKA İLK import olmalı (ESM hoisting: bu, aşağıdaki
// `@enroute/core` import'undan önce çalışır; auth.ts JWT_SECRET'i okumadan
// önce process.env dolu olur).
import "./env.js";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { createAdminGate } from "./admin-gate.js";
import { createSetupGate } from "./setup-gate.js";
import {
  analyzeRegionAnomaly,
  closePool,
  formatRetrievalForPrompt,
  customerInScope,
  getCustomerSales,
  getKomutaSnapshot,
  getKomutaFacets,
  getMapFacets,
  getCustomerReorder,
  getWietnauerYonetimSnapshot,
  getWietnauerMarkaSnapshot,
  getWietnauerAktivasyonSnapshot,
  getWietnauerIskontoSnapshot,
  getWietnauerSegmentSnapshot,
  getWietnauerSahaSnapshot,
  getWietnauerSatisSnapshot,
  getWietnauerStokSnapshot,
  getTenantConfig,
  maskDemoSnapshot,
  getUserPerm,
  getAllPerms,
  setUserPerm,
  deleteUserPerm,
  isAdminUser,
  getRadarDefinition,
  getReport,
  getSyncStatus,
  listMapCustomers,
  listMapRegions,
  listMapCityYoY,
  listRadarDefinitions,
  listReports,
  loadSnapshot,
  nowAnchorDate,
  resolveNowAnchor,
  retrieve,
  runAgent,
  runForesight,
  runRadar,
  runReadOnly,
  runReport,
  saveReport,
  syncMapData,
  cacheStats,
  cachedClear,
  authenticateUser,
  signSession,
  verifySession,
  runWithDbId,
  listSelectableDatabases,
  resolveTenantScope,
  listAllowedDistributors,
  listTopActiveDistIds,
  listMerkezScopes,
  AUTH_COOKIE_NAME,
  scopeSingleDistId,
  type TenantScope,
  // Insider Konfigüratörü (Faz A Dalga 2 müşteri kırılımı; Faz B Dalga 1
  // ürün/marka + bölge) — çekirdek servisler; bkz. packages/core/src/tenant/
  // {customer,product,region}-breakdown-config-service.ts, db-connection-config.ts.
  getCustomerBreakdownConfigMeta,
  previewCustomerBreakdownCandidate,
  saveCustomerBreakdownOverride,
  resetCustomerBreakdownOverride,
  getProductBreakdownConfigMeta,
  previewProductBreakdownCandidate,
  saveProductBreakdownOverride,
  resetProductBreakdownOverride,
  getRegionBreakdownConfigMeta,
  previewRegionBreakdownCandidate,
  saveRegionBreakdownOverride,
  resetRegionBreakdownOverride,
  LiveSchemaValidationError,
  testDbConnection,
  connectWithMssql,
  getDbConnectionMeta,
  saveDbConnectionOverride,
  getDatabasesConfig,
  saveDatabasesOverride,
  // Kodsuz tenant onboarding (Faz A Dalga 1) — tenant KİMLİĞİ; bkz.
  // packages/core/src/tenant/tenant-config-service.ts.
  getActiveTenantDefinitionMeta,
  saveTenantDefinitionOverride,
  resetTenantDefinitionOverride,
  isActiveTenantId,
  TenantValidationError,
  TenantIdError,
  // Güvenli setup modu (Faz A Dalga 2) — bkz. packages/core/src/tenant/setup-mode.ts.
  isTenantFullyMissing,
  resolveActiveTenantId,
} from "@enroute/core";

// `adminUsername` — merkezi admin-gate middleware'inin (aşağıda,
// `/api/admin/*`) doğruladığı session'dan set ettiği actor; config
// endpoint'leri audit-trail'e bunu yazar (client body'sinden ASLA).
const app = new Hono<{ Variables: { adminUsername: string } }>();
app.use("/api/*", cors({ origin: ["http://localhost:3000", "http://127.0.0.1:3000"] }));

app.get("/api/health", (c) =>
  c.json({ ok: true, repoRoot: REPO_ROOT, db: process.env.MSSQL_DATABASE }),
);

// ---------------------------------------------------------------------------
// Auth — kullanıcı girişi + dist-bazlı yetkilendirme
//
// Hono API = güvenlik otoritesi. Dashboard (Next) yalnızca cookie köprüsü:
// login token'ını :3000 cookie'sine yazar ve sonraki her veri isteğinde
// `Authorization: Bearer <token>` olarak buraya geri gönderir. Dist kullanıcı
// doğrudan API'ye ham istek atsa bile scope JWT'den çözülür — filtre atlanamaz.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GUV-06 — basit in-memory rate limiter (harici bağımlılık yok)
//
// Sabit pencereli sayaç: her IP+bucket için `count` ve `resetAt` (pencere
// bitiş zamanı, epoch ms) tutulur. Pencere dolduğunda (`now >= resetAt`)
// sayaç sıfırlanır. Tek process / tek instance için yeterli — burada Redis
// gibi paylaşımlı bir store gerektirecek ölçek yok (dashboard iç kullanım
// aracı, yatay ölçeklenen public API değil).
//
// Bellek büyümesi: `buckets` Map'i asla temizlenmiyormuş gibi görünse de her
// giriş sabit boyutlu ({count,resetAt}) ve anahtar sayısı gerçek dünyada
// benzersiz-IP sayısıyla sınırlı (saha personeli + birkaç merkez kullanıcısı
// — binlerce değil). Yine de sınırsız büyümeyi önlemek için basit bir LRU-ish
// temizlik: periyodik olarak süresi dolmuş kayıtları sil.
// ---------------------------------------------------------------------------
type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

// Süresi dolmuş bucket'ları periyodik temizle — sınırsız Map büyümesini önler.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, b] of rateBuckets) {
      if (now >= b.resetAt) rateBuckets.delete(key);
    }
  },
  5 * 60 * 1000,
).unref();

/** İstek IP'sini çıkar: x-forwarded-for → x-real-ip → "unknown" (yine de bucket'lanır, tek havuzda sınırlanır). */
function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) {
    // "client, proxy1, proxy2" — ilk (en sol) gerçek istemci IP'si.
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Bucket'ın şu an limiti aşıp aşmadığını kontrol eder — sayacı ARTIRMAZ (salt-okunur). */
function isRateLimited(bucketPrefix: string, ip: string, maxRequests: number): boolean {
  const key = `${bucketPrefix}:${ip}`;
  const existing = rateBuckets.get(key);
  if (!existing || Date.now() >= existing.resetAt) return false;
  return existing.count >= maxRequests;
}

/** Bucket sayacını bir artırır (pencere dolmuşsa/yoksa yeniden başlatır). */
function recordRateLimitHit(bucketPrefix: string, ip: string, windowMs: number): void {
  const key = `${bucketPrefix}:${ip}`;
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || now >= existing.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  existing.count += 1;
}

/**
 * Sabit pencereli rate-limit kontrolü: kontrol + artırım tek adımda.
 * Aşıldıysa `false` döner (çağıran 429 üretir, sayaç artmaz); aksi halde
 * sayaç artırılır ve `true` döner. Ağır uçlar (generate/explain/run-sql) gibi
 * "her istekte say" senaryoları için; login'in "yalnızca başarısızda say"
 * davranışı `isRateLimited` + `recordRateLimitHit` ikilisiyle ayrı kurulur.
 */
function checkRateLimit(
  bucketPrefix: string,
  ip: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  if (isRateLimited(bucketPrefix, ip, maxRequests)) return false;
  recordRateLimitHit(bucketPrefix, ip, windowMs);
  return true;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const LOGIN_RATE_LIMIT = 10; // IP başına dakikada ~10 deneme
const HEAVY_RATE_LIMIT = 20; // IP başına dakikada ~20 (generate/explain/run-sql)

/** İstekten oturum token'ını çıkar: önce Authorization: Bearer, sonra cookie. */
function tokenFromRequest(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const cookie = c.req.header("cookie") ?? c.req.header("Cookie");
  if (cookie) {
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE_NAME}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

/**
 * İstekten TenantScope çöz. Oturum yoksa Error("UNAUTHENTICATED") fırlatır —
 * çağıran 401'e çevirir. `selectedDistKod` merkez kullanıcı için drill-down.
 */
// Sentetik demo tenant'ı mı (MSSQL yok)? Yalnızca `demoData=true` config'inde
// (fmcg-demo). Login normal işler (statik demo kullanıcısı auth.ts'te); bu flag
// sadece komuta refresh yollarını kapatmak için (aşağıda).
//
// BOOT-ÇÖKME ÖNLEME (Faz A Dalga 2, Faz 0 Bootstrap sözleşmesi): aktif
// tenant HİÇ tanımlı değilse (`isTenantFullyMissing()` — ne REGISTRY'de ne
// tenant-definition store'da) `getTenantConfig()` THROW eder. Bu satır
// MODÜL-SEVİYESİNDE (import anında) çalıştığı için, korumasız bir çağrı
// TÜM sunucuyu (setup uçları dahil) ayağa kalkmadan çökertirdi — setup
// modunun VAR OLMA SEBEBİNİN kendisini imkansız kılardı. `isTenantFullyMissing()`
// asla throw etmez; bu durumda `DEMO_DATA=false` güvenli bir varsayılandır
// (gerçek demoData henüz okunabilir değil — night-refresh zaten aşağıda
// `DEMO_DATA` kontrolüyle devre dışı kalır, zararsız).
const DEMO_DATA = isTenantFullyMissing() ? false : getTenantConfig().demoData === true;

async function scopeFromRequest(
  c: { req: { header: (k: string) => string | undefined } },
  selectedDistKod?: number | null,
): Promise<TenantScope> {
  const session = await verifySession(tokenFromRequest(c));
  // Erişim politikası: yalnızca merkez. Dist tipli (veya eski) token'lar
  // kimliksiz sayılır → endpoint'ler 401 döner, client login'e yönlendirir
  // (login de dist kullanıcıyı 403 ile engeller). Sunucu-otoriter.
  if (session && session.role !== "merkez") throw new Error("UNAUTHENTICATED");
  return resolveTenantScope(session, selectedDistKod ?? null);
}

// ---------------------------------------------------------------------------
// GÜVENLİ SETUP MODU — Faz A Dalga 2 (Faz 0 Bootstrap sözleşmesi)
//
// Boş sunucu tavuk-yumurtası: yeni `TENANT=<id>` ile açılışta tenant-tanımı
// yoksa `getTenantConfig()` THROW eder — normal admin girişi (session +
// admin rolü) MÜMKÜN DEĞİLDİR (henüz ne kullanıcı ne DB var). Bu üç uç
// `createSetupGate()`'in (SETUP_TOKEN header) koruduğu AYRI bir kapıdan
// geçer — session/admin-gate GEREKMEZ.
//
// KAYIT SIRASI KRİTİK: bu blok, GLOBAL SESSION GUARD'DAN (aşağıda,
// "GLOBAL AUTH GUARD" başlığı altında) ÖNCE kayıtlı — Hono eşleşen
// middleware/route'ları KAYIT SIRASINA göre zincirler; bu route'lar (terminal
// handler'lar) session guard'a HİÇ uğramaz. Bu satırların ALTINA yeni bir
// `/api/setup/*` route EKLEME — session guard'dan SONRAYA düşer, o zaman
// session gerektirmeye başlar (sessizce kırılan bir sözleşme).
//
// `PUBLIC_ROUTES`'A EKLENMEZ (Faz 0 H-1) — bkz. `setup-gate.ts` dosya-üstü
// notu: tek gerçek kapı `createSetupGate()`, durum-türevli fail-closed
// (`isSetupModeActive()` HER İSTEKTE canlı kontrol eder, in-memory bayrak
// yok — aktif tenant tamamlanınca bir SONRAKİ istek otomatik 404 alır).
//
// Server-otoriter tenant (Faz 0 şart #3): `id` hiçbir setup ucunda body'den
// ALINMAZ — `resolveActiveTenantId()` DAİMA `process.env.TENANT`'ı okur.
// ---------------------------------------------------------------------------

const TenantLabelsBody = z.object({
  morningHeadline: z.string().min(1),
  channelTypeTitle: z.string().min(1),
  channelTypeSource: z.string().min(1),
  mapEmptyDataSource: z.string().min(1),
  kpiSourceNote: z.string().min(1),
  volumeMultiplierHint: z.string().min(1),
});

const TenantTaxBody = z.object({
  key: z.string().min(1),
  label: z.string(),
  showInToggle: z.boolean(),
});

// Admin panel `/api/admin/config/tenant` POST'u `id`'yi body'de bekler
// (aktif tenant'la eşleşmesi ayrıca doğrulanır, bkz. aşağıdaki route).
// Setup akışı `.omit({ id: true })` ile AYNI şemayı `id`SİZ kullanır — id
// orada server tarafında `resolveActiveTenantId()`'den gelir.
const TenantDefinitionBody = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  industry: z.enum(["alcohol", "fmcg"]),
  strategicBrands: z.array(z.string().min(1)).min(1),
  labels: TenantLabelsBody,
  tax: TenantTaxBody,
  logoMark: z.string().min(1).optional(),
});
const SetupTenantDefinitionBody = TenantDefinitionBody.omit({ id: true });

const DbConnectionBody = z.object({
  server: z.string().min(1),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
});

app.use("/api/setup/*", createSetupGate());

// POST test — Security H2 ile AYNI sözleşme: ham mssql hatası ASLA dönmez,
// yalnız `{ok}`.
app.post("/api/setup/db-connection/test", async (c) => {
  try {
    const body = DbConnectionBody.parse(await c.req.json());
    return c.json(await testDbConnection(connectWithMssql, body));
  } catch (err) {
    // Buraya yalnız zod parse hatası düşer — gerçek bağlantı hatası
    // `testDbConnection` içinde zaten yutulup sanitize edildi.
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST — creds'i şifreli (AES-256-GCM) yaz + aktif pool'u kapat (GÖREV 1:
// bir sonraki `getPool()` çağrısı yeni creds'le taze bağlantı açar — "kaydet
// sonrası yeni bağlantı" güvenli reset yolu).
app.post("/api/setup/db-connection", async (c) => {
  try {
    const body = DbConnectionBody.parse(await c.req.json());
    await saveDbConnectionOverride({
      tenantId: resolveActiveTenantId(),
      actor: "setup-token",
      input: body,
    });
    await closePool().catch(() => undefined);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST — tenant KİMLİĞİNİ oluştur/güncelle. `id` body'de YOK (schema
// `.omit`) — server `resolveActiveTenantId()` ile `process.env.TENANT`'ı
// kullanır (server-otoriter, Faz 0 şart #3). `saveTenantDefinitionOverride`
// Dalga 1'in servisidir (reuse) — REGISTRY-çakışma + zorunlu-alan
// doğrulaması, `clearTenantCache()`, audit hepsi ORTAK yoldan geçer.
app.post("/api/setup/tenant", async (c) => {
  try {
    const body = SetupTenantDefinitionBody.parse(await c.req.json());
    const config = await saveTenantDefinitionOverride({
      actor: "setup-token",
      input: { ...body, id: resolveActiveTenantId() },
    });
    return c.json({ ok: true, config });
  } catch (err) {
    if (err instanceof TenantValidationError) {
      return c.json({ error: err.message, issues: err.issues }, 400);
    }
    return c.json({ error: (err as Error).message }, 400);
  }
});

// "Kurulum gerekli" kısa-devresi — aktif tenant TÜMÜYLE tanımsızken (Boot-
// çökme önleme, DEMO_DATA yorumuna bkz.) `/api/setup/*` VE `/api/health`
// DIŞINDAKİ her `/api/*` isteği için temiz bir 503 döner. `/api/setup/*`
// zaten yukarıdaki kayıt sırası nedeniyle bu middleware'e hiç uğramaz
// (terminal handler'lar önce eşleşir) — buradaki path kontrolü savunma-
// derinliği (sıra yanlışlıkla bozulursa bile setup uçları burada 503'e
// düşmesin diye). Auth/login DAHİL her şeyi kapsar: tenant yokken
// `authenticateUser` zaten `getTenantConfig()`'e bağımlı (auth.ts) — bu
// kısa-devre olmadan ham "[tenant] Bilinmeyen TENANT=..." hatası 500 olarak
// sızardı; burada TEK, tutarlı, veri sızdırmayan bir mesajla kesilir.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health" || c.req.path.startsWith("/api/setup/")) return next();
  if (isTenantFullyMissing()) {
    return c.json({ error: "Kurulum gerekli — bu sunucuda henüz aktif bir tenant tanımı yok." }, 503);
  }
  return next();
});

// POST /api/auth/login — kimlik doğrula, JWT üret. Token body'de döner;
// dashboard onu :3000 HttpOnly cookie'sine yazar.
//
// GUV-06: IP başına dakikada ~10 BAŞARISIZ deneme. Sayaç yalnızca kimlik
// doğrulama başarısız olduğunda artar — meşru kullanıcı doğru şifreyle art
// arda giriş yapsa (ör. çoklu sekme/cihaz) rate-limit'e takılmaz; brute-force
// deneme dizisi ise 10 hatalı denemeden sonra 429'a düşer.
app.post("/api/auth/login", async (c) => {
  try {
    const ip = clientIp(c);
    if (isRateLimited("login", ip, LOGIN_RATE_LIMIT)) {
      return c.json({ error: "Çok fazla başarısız deneme. Lütfen bir dakika sonra tekrar deneyin." }, 429);
    }
    const body = (await c.req.json()) as { username?: string; password?: string; dbId?: string };
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    if (!username || !password) {
      return c.json({ error: "Kullanıcı adı ve şifre gerekli" }, 400);
    }
    // Çok-DB (login'de DB seçimi): tenant birden çok DB tanımlıysa `dbId`
    // ZORUNLU ve allowlist'te olmalı; tek-DB tenant'ta gönderilse bile YOK
    // SAYILIR (effectiveDbId undefined → bugünkü tek-DB yolu). Auth sorgusu
    // SEÇİLEN DB'ye gitsin diye `runWithDbId` ile sarılır.
    const selectable = listSelectableDatabases();
    let effectiveDbId: string | undefined;
    if (selectable.length > 0) {
      const wanted = typeof body.dbId === "string" ? body.dbId.trim() : "";
      if (!wanted || !selectable.some((d) => d.id === wanted)) {
        return c.json({ error: "Geçersiz veya eksik veritabanı seçimi." }, 400);
      }
      effectiveDbId = wanted;
    }
    const user = await runWithDbId(effectiveDbId, () => authenticateUser(username, password));
    if (!user) {
      recordRateLimitHit("login", ip, RATE_LIMIT_WINDOW_MS);
      return c.json({ error: "Geçersiz kullanıcı adı veya şifre" }, 401);
    }
    // Seçili DB'yi oturuma (JWT) göm — sonraki her istek bu DB'ye yönlenir.
    user.dbId = effectiveDbId;
    // Erişim politikası: şu an yalnızca MERKEZ tipli kullanıcılar. Distribütör
    // (dist) tipli hesaplar geçerli şifreyle bile giremez. Kimlik doğru olduğu
    // için rate-limit sayılmaz.
    if (user.role !== "merkez") {
      return c.json(
        { error: "Bu uygulamaya şu an yalnızca merkez kullanıcılar erişebilir." },
        403,
      );
    }
    const token = await signSession(user);
    return c.json({
      token,
      user: {
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        allowedDistKods: user.allowedDistKods,
        dbId: user.dbId ?? null,
      },
    });
  } catch (err) {
    console.error("[/api/auth/login] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// GET /api/auth/me — token doğrula, kullanıcıyı döner.
app.get("/api/auth/me", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum bulunamadı" }, 401);
  // Erişim politikası: yalnızca merkez kullanıcılar. Dist token'ı → 403.
  if (session.role !== "merkez") {
    return c.json({ error: "Bu uygulamaya yalnızca merkez kullanıcılar erişebilir." }, 403);
  }
  const perm = getUserPerm(session.username); // ekran + (dist/şehir) yetkisi (store)
  return c.json({
    user: {
      userId: session.userId,
      username: session.username,
      displayName: session.displayName,
      role: session.role,
      isAdmin: isAdminUser(session.username), // içerik + Yetkiler ekranı erişimi
      allowedDistKods: session.allowedDistKods,
      allowedScreens: perm.screens, // null → hepsi
      allowedCities: perm.cities, // null → hepsi
      dbId: session.dbId ?? null, // çok-DB: aktif veritabanı (tek-DB'de null)
    },
  });
});

// GET /api/auth/distributors — kullanıcının izinli distribütörleri (dropdown).
app.get("/api/auth/distributors", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum bulunamadı" }, 401);
  try {
    // Bu uç global auth guard'dan ÖNCE tanımlı (PUBLIC_ROUTES) → ALS'yi guard
    // sarmalamaz; DB sorgusu seçili DB'ye gitsin diye burada elle sarıyoruz.
    const distributors = await runWithDbId(session.dbId, () => listAllowedDistributors(session));
    return c.json({ distributors, role: session.role });
  } catch (err) {
    console.error("[/api/auth/distributors] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// GET /api/auth/databases — çok-DB kurulumunda login dropdown'ı için
// seçilebilir veritabanları (yalnız id+label). Public (login ÖNCESİ okunur);
// tek-DB tenant'ta boş dizi → dashboard dropdown'ı gizler. Ham `database`
// adları BURADA DÖNMEZ (yalnız kullanıcıya gösterilen etiket + kısa kimlik).
app.get("/api/auth/databases", (c) => {
  try {
    return c.json({ databases: listSelectableDatabases() });
  } catch {
    // Tenant henüz tanımsızsa (setup öncesi) sessizce boş dön.
    return c.json({ databases: [] });
  }
});

// POST /api/auth/logout — stateless JWT; dashboard cookie'yi siler. Burada
// yalnızca 200 döner (simetri için).
app.post("/api/auth/logout", (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// GLOBAL AUTH GUARD — GUV-03
//
// Bu middleware'den SONRA tanımlanan her `/api/*` route, geçerli bir oturum
// zorunlu kılar (401 if none). PUBLIC_ROUTES allowlist'i login akışını ve
// health check'i açık tutar; bunların dışındaki HER ŞEY (run-sql, retrieve,
// reports*, radars*, map*, komuta*, wietnauer*, cache*) buradan geçer.
//
// Not: endpoint-içi `scopeFromRequest` çağrıları (401/403 + dist-scope
// zorlaması) hâlâ yerinde duruyor — çift kontrol zararsız, guard yalnızca
// dış katmanı kapatıyor. Guard'dan SONRA eklenen route'lar korumasız kalır;
// yeni route eklerken bu satırın ALTINDA olduğundan emin ol.
// ---------------------------------------------------------------------------
const PUBLIC_ROUTES = new Set<string>([
  "/api/health",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/distributors",
  "/api/auth/databases",
]);

app.use("/api/*", async (c, next) => {
  if (PUBLIC_ROUTES.has(c.req.path)) return next();
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  // Güvenlik (LOW-1 sertleştirme): tenant çok-DB İSE oturumda açık bir `dbId`
  // ZORUNLU. `dbId`'siz bir oturum (ör. çok-DB açılmadan ÖNCE edinilmiş eski
  // token) sessizce varsayılan/ilk DB'ye düşmesin — yeniden-login'e zorla.
  // Böylece "her çok-DB isteğinde açık bir dbId vardır" değişmezi katılaşır.
  if (!session.dbId && listSelectableDatabases().length > 0) {
    return c.json({ error: "Oturumu yenileyin — veritabanı seçimi gerekli." }, 401);
  }
  // Çok-DB: isteğin geri kalanını oturumdaki `dbId` aktifken çalıştır →
  // guard'dan SONRA tanımlı tüm veri uçları (`getPool`/`getLocalDb`) seçili
  // DB'ye yönlenir. Tek-DB'de `dbId` undefined → varsayılan (bugünkü) yol.
  return runWithDbId(session.dbId, () => next());
});

// ---------------------------------------------------------------------------
// MERKEZİ ADMIN GATE — Security H3
//
// `/api/admin/*` altındaki HER route (yukarıdaki global guard'dan sonra bile)
// ayrıca admin rolü zorunlu kılar. Bu satırdan SONRA tanımlanan yeni admin
// endpoint'leri (Insider Konfigüratörü `config/*` dahil) `isAdminUser`
// kontrolünü KENDİLERİ TEKRARLAMAZ — bu middleware zaten 401/403'ü kapatır ve
// doğrulanmış kullanıcı adını `adminUsername` context değişkenine yazar
// (audit-trail actor'ı için).
//
// Var olan `/api/admin/perms|cities|dists|users|...` uçları (bu dosyada daha
// altta tanımlı) kendi içlerinde hâlâ aynı kontrolü elle yapıyor — bu bir
// hata DEĞİL: Hono, bir isteğe eşleşen tüm middleware/route'ları KAYIT
// SIRASINA göre zincirler; bu middleware onlardan ÖNCE kayıtlı olduğu için
// onları da kapsar (çift kontrol zararsız, dokunulmadı — mevcut davranış
// korunur). Yeni route eklerken bu satırın ALTINDA `/api/admin/...` deseniyle
// tanımlandığından emin ol.
// ---------------------------------------------------------------------------
app.use("/api/admin/*", createAdminGate(tokenFromRequest));

const RetrieveBody = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(40).default(10),
});

app.post("/api/retrieve", async (c) => {
  const body = RetrieveBody.parse(await c.req.json());
  const snap = await loadSnapshot({ repoRoot: REPO_ROOT });
  const results = retrieve(body.query, snap, {
    topK: body.topK,
    expandFkNeighbors: true,
  });
  return c.json({
    results: results.map((r) => ({
      fullName: r.table.fullName,
      label: r.table.label,
      description: r.table.description,
      score: r.score,
      reasons: r.reasons,
      primaryKeys: r.table.primaryKeys,
      columns: r.table.columns.map((cl) => ({
        name: cl.name,
        dataType: cl.dataType,
        isNullable: cl.isNullable,
        isPrimaryKey: cl.isPrimaryKey,
        description: cl.description,
        label: cl.label,
      })),
      fkNeighbors: r.fkNeighbors,
    })),
    promptContext: formatRetrievalForPrompt(results),
  });
});

const RunSqlBody = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10_000).default(1000),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
});

// GÜVENLİK: guard yukarıda zaten oturum zorunlu kılıyor (401 if none). Ek
// olarak: (1) yalnızca merkez rolü serbest SQL çalıştırabilir — dist
// kullanıcı için 403; (2) üretimde varsayılan KAPALI — açmak isteyen
// ENABLE_RUN_SQL=1 vermeli.
// GUV-06: IP başına dakikada ~20 istek — ağır uç (serbest SQL çalıştırır).
app.post("/api/run-sql", async (c) => {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_RUN_SQL !== "1") {
    return c.json({ error: "not found" }, 404);
  }
  if (!checkRateLimit("heavy", clientIp(c), HEAVY_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return c.json({ error: "Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin." }, 429);
  }
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  if (scope.type !== "merkez") {
    return c.json({ error: "Bu işlem yalnızca merkez kullanıcılara açık" }, 403);
  }
  try {
    const body = RunSqlBody.parse(await c.req.json());
    const result = await runReadOnly(body.query, {
      limit: body.limit,
      timeoutMs: body.timeoutMs,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/reports", async (c) => {
  const reports = await listReports(REPO_ROOT);
  return c.json({ reports });
});

app.get("/api/reports/:id", async (c) => {
  const r = await getReport(REPO_ROOT, c.req.param("id"));
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json(r);
});

const SaveReportBody = z.object({
  name: z.string().min(1),
  sql: z.string().min(1),
  description: z.string().optional(),
  brief: z.string().optional(),
  userPrompt: z.string().optional(),
  retrievedTables: z.array(z.string()).optional(),
  id: z.string().optional(),
});

app.post("/api/reports", async (c) => {
  const body = SaveReportBody.parse(await c.req.json());
  const report = await saveReport(REPO_ROOT, body, body.id);
  return c.json(report);
});

app.post("/api/reports/:id/run", async (c) => {
  try {
    const id = c.req.param("id");
    const limitParam = c.req.query("limit");
    const { result, run } = await runReport(REPO_ROOT, id, {
      limit: limitParam ? parseInt(limitParam, 10) : undefined,
    });
    return c.json({ run, fullResult: { rowCount: result.rowCount, truncated: result.truncated } });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

const GenerateReportBody = z.object({
  prompt: z.string().min(1),
  /** If true, persist the generated report after running it. */
  save: z.boolean().default(false),
  /** Optional explicit name; auto-generated if omitted. */
  name: z.string().optional(),
});

// GUV-06: IP başına dakikada ~20 istek — ağır uç (Gemini agent loop + SQL).
app.post("/api/reports/generate", async (c) => {
  if (!checkRateLimit("heavy", clientIp(c), HEAVY_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return c.json({ error: "Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin." }, 429);
  }
  try {
    const body = GenerateReportBody.parse(await c.req.json());

    // Run the Gemini function-calling agent. It is the agent — not us — that
    // calls retrieve_schema, run_sql, and finalize. We only map the result.
    const agentRun = await runAgent(body.prompt);

    if (!agentRun.final) {
      const lastError = [...agentRun.steps]
        .reverse()
        .find((s) => s.kind === "tool_result" && !s.ok);
      return c.json(
        {
          error:
            "Ajan finalize çağrısı yapamadı; üretim adımları sınırı aşıldı.",
          lastError: lastError && lastError.kind === "tool_result" ? lastError.summary : undefined,
          steps: agentRun.steps,
        },
        400,
      );
    }

    let savedId: string | undefined;
    if (body.save) {
      const name = body.name ?? body.prompt.slice(0, 60);
      const saved = await saveReport(REPO_ROOT, {
        name,
        sql: agentRun.final.sql,
        userPrompt: body.prompt,
        brief: agentRun.final.brief,
        retrievedTables: agentRun.retrievedTables,
      });
      await runReport(REPO_ROOT, saved.id, { limit: 500 });
      savedId = saved.id;
    }

    return c.json({
      sql: agentRun.final.sql,
      brief: agentRun.final.brief,
      result: {
        rowCount: agentRun.rowCount,
        truncated: agentRun.truncated,
        durationMs: agentRun.durationMs,
        rows: agentRun.rows.slice(0, 100),
      },
      retrieved: agentRun.retrievedTables.map((fullName) => ({
        fullName,
        score: 0,
        description: undefined,
      })),
      steps: agentRun.steps,
      savedId,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/radars", async (c) => {
  const defs = await listRadarDefinitions(REPO_ROOT);
  return c.json({
    radars: defs.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      tagline: d.tagline,
      defaultParams: d.defaultParams,
    })),
  });
});

app.get("/api/radars/:id", async (c) => {
  const def = await getRadarDefinition(REPO_ROOT, c.req.param("id"));
  if (!def) return c.json({ error: "not found" }, 404);
  return c.json(def);
});

app.post("/api/radars/:id/run", async (c) => {
  try {
    const def = await getRadarDefinition(REPO_ROOT, c.req.param("id"));
    if (!def) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(body ?? {})) {
      if (typeof v === "string" || typeof v === "number") params[k] = v;
    }
    const forceRefresh = !DEMO_DATA && c.req.query("refresh") === "1";
    const run = await runRadar(def, params, { forceRefresh });
    return c.json(run);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Click-to-explain: a radar anomaly (or any chart cell) hands its self-contained
// "explainPrompt" to the same agent loop that powers /reports/generate. The
// agent retrieves schema, runs SQL, and returns a Turkish 2-3 sentence cause.
//
// GUV-06: IP başına dakikada ~20 istek — ağır uç (Gemini agent loop + SQL).
app.post("/api/radars/:id/explain", async (c) => {
  if (!checkRateLimit("heavy", clientIp(c), HEAVY_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return c.json({ error: "Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin." }, 429);
  }
  try {
    const body = (await c.req.json()) as { question?: string };
    const question = body.question?.trim();
    if (!question) {
      return c.json({ error: "question required" }, 400);
    }
    const agentRun = await runAgent(question);
    if (!agentRun.final) {
      // Agent loop exhausted MAX_ITERATIONS or gave up without a successful
      // SQL. Surface the last few step summaries so the dashboard panel can
      // show *why* — silent "ok with no brief" is the worst possible UX.
      const lastSteps = agentRun.steps.slice(-6).map((s) => {
        if (s.kind === "tool_call") return `→ ${s.tool}(${JSON.stringify(s.args).slice(0, 200)})`;
        if (s.kind === "tool_result")
          return `   ${s.ok ? "✓" : "✗"} ${s.tool}: ${s.summary}`;
        if (s.kind === "give_up") return `× model verdi: ${s.reason}`;
        if (s.kind === "final") return `✓ finalize`;
        return "";
      });
      console.error("[/api/radars/:id/explain] agent produced no final answer:", lastSteps);
      return c.json(
        {
          error:
            "Agent yanıt üretemedi (tablo bulunamadı veya sorgu döngüsü sonuçsuz bitti). Son adımlar:\n" +
            lastSteps.join("\n"),
        },
        502,
      );
    }
    return c.json({
      question,
      brief: agentRun.final.brief,
      sql: agentRun.final.sql,
      rowCount: agentRun.rowCount,
      sampleRows: agentRun.rows.slice(0, 8),
      steps: agentRun.steps,
    });
  } catch (err) {
    console.error("[/api/radars/:id/explain] failed:", err);
    return c.json({ error: (err as Error).message }, 400);
  }
});

// All map reads go through the SQLite mirror — no in-memory cache layer
// needed, because the mirror IS the cache. The mirror only refreshes
// when /api/map/sync is called (via the "Verileri yenile" button).

// Composite Risk Score tier'larının runtime guard'ı (server boundary).
const TIER_V2_VALUES = ["healthy", "watch", "risk", "critical", "unknown"] as const;
type TierV2 = (typeof TIER_V2_VALUES)[number];
function parseTier(raw: string | undefined): TierV2 | undefined {
  if (!raw) return undefined;
  return (TIER_V2_VALUES as readonly string[]).includes(raw)
    ? (raw as TierV2)
    : undefined;
}

// Harita endpoint'leri — GÜVENLİK: her biri auth ister (401 if no session).
// Dist kullanıcı yalnızca kendi izinli dist'lerinin müşteri/bölge verisini
// görür; `allowedDistKods` scope'tan zorlanır (sunucu-otoriter), mevcut
// query filtreleri (sehir/bolge/riskTier vb.) korunur ve bunlarla birlikte
// AND'lenir.
app.get("/api/map/customers", async (c) => {
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const sehir = c.req.query("sehir") ?? undefined;
    const distKodRaw = c.req.query("distKod");
    const distKod = distKodRaw ? parseInt(distKodRaw, 10) : undefined;
    const salesFilterRaw = c.req.query("salesFilter");
    const salesFilter: "with" | "without" | undefined =
      salesFilterRaw === "with" || salesFilterRaw === "without"
        ? salesFilterRaw
        : undefined;
    const riskTierRaw = c.req.query("riskTier");
    const riskTier =
      riskTierRaw === "high" || riskTierRaw === "medium" || riskTierRaw === "low" || riskTierRaw === "active"
        ? (riskTierRaw as "high" | "medium" | "low" | "active")
        : undefined;
    // Yeni composite tier filtresi — geçirilirse riskTier'i bypass eder.
    const tier = parseTier(c.req.query("tier"));
    const minDaysVisitRaw = c.req.query("minDaysSinceVisit");
    const minDaysSinceVisit = minDaysVisitRaw ? parseInt(minDaysVisitRaw, 10) : undefined;
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
    // md11 — üstteki dönem filtresi (satış-aktivite penceresi). Whitelist:
    // yalnızca 30/60/90; başka bir değer ya da eksikse core tarafı 30'a
    // (mevcut davranış) düşer.
    const activityDaysRaw = c.req.query("activityDays") ?? c.req.query("days");
    const activityDaysParsed = activityDaysRaw ? parseInt(activityDaysRaw, 10) : undefined;
    const activityDays =
      activityDaysParsed === 30 || activityDaysParsed === 60 || activityDaysParsed === 90
        ? activityDaysParsed
        : undefined;

    const bolge = c.req.query("bolge") ?? undefined;
    const region = c.req.query("region") ?? undefined;
    const customers = await listMapCustomers(REPO_ROOT, {
      sehir,
      distKod,
      bolge,
      region,
      salesFilter,
      riskTier,
      tier,
      minDaysSinceVisit,
      activityDays,
      limit,
      allowedDistKods: scope.distKods,
      allowedCities: scope.cities,
    });
    return c.json({ count: customers.length, customers });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Bölge bazlı toplu görünüm — region toggle açıldığında çağrılır.
// Aynı filter parametreleri (sehir/distKod/sales/risk/minVisit) burada da
// geçerli; region aggregation bunlardan etkilenir.
app.get("/api/map/regions", async (c) => {
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const sehir = c.req.query("sehir") ?? undefined;
    const distKodRaw = c.req.query("distKod");
    const distKod = distKodRaw ? parseInt(distKodRaw, 10) : undefined;
    const salesFilterRaw = c.req.query("salesFilter");
    const salesFilter: "with" | "without" | undefined =
      salesFilterRaw === "with" || salesFilterRaw === "without"
        ? salesFilterRaw
        : undefined;
    const riskTierRaw = c.req.query("riskTier");
    const riskTier =
      riskTierRaw === "high" || riskTierRaw === "medium" || riskTierRaw === "low" || riskTierRaw === "active"
        ? (riskTierRaw as "high" | "medium" | "low" | "active")
        : undefined;
    const tier = parseTier(c.req.query("tier"));
    const minDaysVisitRaw = c.req.query("minDaysSinceVisit");
    const minDaysSinceVisit = minDaysVisitRaw ? parseInt(minDaysVisitRaw, 10) : undefined;
    const regions = await listMapRegions(REPO_ROOT, {
      sehir,
      distKod,
      salesFilter,
      riskTier,
      tier,
      minDaysSinceVisit,
      allowedDistKods: scope.distKods,
    });
    return c.json({ count: regions.length, regions });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Şehir bazlı YoY — /map sayfasının view=city drill seviyesi için.
// MSSQL'den taze hesaplar: son 30g vs geçen yıl aynı 30g (cache yok, ağır
// değil — 81 il agregasyonu).
app.get("/api/map/cities", async (c) => {
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const region = c.req.query("region")?.trim() || undefined;
    const cities = await listMapCityYoY(region, scope.distKods);
    return c.json({ count: cities.length, cities });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Facets/sync — meta ve aksiyon uçları; dist-filtre gerektirmez (sync tüm
// mirror'ı tazeler, merkez işi) ama yine de oturum zorunlu.
app.get("/api/map/facets", async (c) => {
  try {
    await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    return c.json(getMapFacets(REPO_ROOT));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/map/sync-status", async (c) => {
  try {
    await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    return c.json(getSyncStatus(REPO_ROOT));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/map/sync", async (c) => {
  // Ağır harita senkronu yalnızca admin: normal kullanıcılar datayı yoramasın.
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
  try {
    // invalidateKomuta:false — map sync komuta'nın MSSQL kaynağını değiştirmez
    // (komuta yerel müşteri aynasını okumaz); komuta yalnız kendi forceRefresh
    // akışıyla (gece/manuel) tazelenir. Burada komuta'yı silmek, taze brief'i
    // ve diğer merkez scope'ları gereksiz yere uçururdu.
    const status = await syncMapData(REPO_ROOT, { invalidateKomuta: false });
    return c.json(status);
  } catch (err) {
    // Log the full stack server-side so we can inspect it in the API log,
    // and bubble both the message AND the first stack frame back to the
    // dashboard so the inline error panel actually points somewhere useful.
    console.error("[/api/map/sync] failed:", err);
    const e = err as Error;
    const firstFrame = e.stack?.split("\n").slice(0, 3).join("\n") ?? "";
    return c.json(
      {
        error: e.message,
        stack: firstFrame,
      },
      500,
    );
  }
});

// Tek-müşteri detay uçları — dist kullanıcı BAŞKA dist'in müşterisini
// göremez. `customerInScope` SQLite mirror'daki dist_kod'a bakarak kontrol
// eder; kapsam dışıysa 403 döner (mevcut olmayan id zaten 404'e düşer).
app.get("/api/map/customers/:id/sales", async (c) => {
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    const allowedDistKods = scope.distKods;
    if (!customerInScope(REPO_ROOT, id, allowedDistKods)) {
      return c.json({ error: "Bu müşteriye erişim yetkiniz yok" }, 403);
    }
    const distKodRaw = c.req.query("distKod");
    const distKod = distKodRaw ? parseInt(distKodRaw, 10) : null;
    const daysRaw = c.req.query("days");
    const days = daysRaw ? parseInt(daysRaw, 10) : 30;
    const forceRefresh = !DEMO_DATA && c.req.query("refresh") === "1";
    const sales = await getCustomerSales(id, distKod, days, { forceRefresh });
    return c.json(sales);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Foresight: deterministic 4-signal pipeline (calendar / YoY / dropped /
// cohort) stitched into a brief + 2-3 actions by a single Gemini call.
// No agent loop — signals are the source of truth, LLM only phrases.
app.post("/api/map/customers/:id/foresight", async (c) => {
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    const allowedDistKods = scope.distKods;
    if (!customerInScope(REPO_ROOT, id, allowedDistKods)) {
      return c.json({ error: "Bu müşteriye erişim yetkiniz yok" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      label?: string;
      windowDays?: number;
      refresh?: boolean;
    };
    const label = body.label?.trim() || `Müşteri #${id}`;
    const windowDays = Number.isFinite(body.windowDays)
      ? Math.max(7, Math.min(30, Math.floor(body.windowDays!)))
      : 14;
    const forceRefresh = body.refresh === true || c.req.query("refresh") === "1";
    const result = await runForesight(id, label, windowDays, { forceRefresh });
    return c.json(result);
  } catch (err) {
    console.error("[/api/map/customers/:id/foresight] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Sipariş Öneri — Insider (FMCG/Panorama) tek müşteri için overdue/winBack/
// crossSell sinyalleri. Dist-scope SUNUCU-OTORİTER: `scopeFromRequest` oturumu
// doğrular, `getCustomerReorder`'a yalnız `scope.distKods`/`scopeSingleDistId`
// geçilir — client'ın gönderdiği herhangi bir dist bilgisi asla güvenilmez.
//
// GUV-06: IP başına dakikada ~20 istek — generate/explain/run-sql ile AYNI
// desen. Ağır uç: 40M satırlık TBLMSDBELGEDETAY'a karşı iki LOOP JOIN sorgusu
// (geçmiş + cross-sell) — burst-abuse tek IP'den DB'yi zorlayabilir.
app.get("/api/reorder/customer", async (c) => {
  if (!checkRateLimit("heavy", clientIp(c), HEAVY_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)) {
    return c.json({ error: "Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin." }, 429);
  }
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    // Ham hata client'a sızmaz — yalnız log'a, response'a jenerik mesaj.
    console.error("[/api/reorder/customer] scope resolution failed:", err);
    return c.json({ error: "Yetki kapsamı çözülemedi" }, 500);
  }
  try {
    const musteriKodRaw = c.req.query("musteriKod");
    const musteriKod = musteriKodRaw != null ? parseInt(musteriKodRaw, 10) : NaN;
    if (!Number.isFinite(musteriKod)) {
      return c.json({ error: "musteriKod zorunlu" }, 400);
    }
    const result = await getCustomerReorder({
      musteriKod,
      allowedDistKods: scope.distKods,
      distId: scopeSingleDistId(scope),
    });
    return c.json(result);
  } catch (err) {
    // Ham DB hatası client'a sızmaz — yalnız log'a, response'a sanitize edilmiş mesaj.
    console.error("[/api/reorder/customer] failed:", err);
    return c.json({ error: "Sipariş önerisi hesaplanamadı" }, 500);
  }
});

// Komuta Köprüsü — CEO/Satış Direktörü ekranı için tek atışta tüm agregat.
// Pahalı (8 paralel SQL + Gemini brief); cache'lenir, "Yenile" ile invalidate.
//
// GÜVENLİK: v3 dashboard'larla aynı desen — auth ister (401 if no session),
// TenantScope snapshot fonksiyonuna geçirilir. Dist kullanıcı yalnızca kendi
// dist(ler)inin bölge/leaderboard/heatmap verisini görür.
app.get("/api/komuta", async (c) => {
  let scope: TenantScope;
  try {
    const distIdRaw = c.req.query("distId");
    const distIdParsed = distIdRaw != null && distIdRaw !== "" ? Number(distIdRaw) : null;
    const requestedDistId = distIdParsed != null && Number.isFinite(distIdParsed) ? distIdParsed : null;
    scope = await scopeFromRequest(c, requestedDistId);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    // Demo (MSSQL yok): force-refresh boş snapshot üretip pre-baked seed'i ezer.
    // Demo'da refresh yok sayılır → hep cache'ten servis edilir.
    const forceRefresh = !DEMO_DATA && c.req.query("refresh") === "1";
    const reelTL = c.req.query("reel") === "1";
    // unit=9le → tüm value alanları 9-Liter-Equivalent volume bazında döner;
    // boş veya başka değer → TL (default).
    const unit = c.req.query("unit") === "9le" ? "9le" as const : "tl" as const;
    // md2 — Cockpit global filtre: Bölge (şehir-tabanlı) + Kanal (müşteri grup
    // kırılımı) + Ürün Grubu (TBLURUNEKGRUP kategori kodu).
    const bolge = c.req.query("bolge")?.trim() || null;
    const kanal = c.req.query("kanal")?.trim() || null;
    const urunGrup = c.req.query("urunGrup")?.trim() || null;
    const snap = await getKomutaSnapshot({
      forceRefresh,
      reelTL,
      unit,
      allowedDistKods: scope.distKods,
      distId: scopeSingleDistId(scope),
      allowedCities: scope.cities,
      bolge,
      kanal,
      urunGrup,
    });
    return c.json(maskDemoSnapshot(snap));
  } catch (err) {
    console.error("[/api/komuta] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// md2 — Cockpit filtre dropdown seçenekleri (Bölge / Kanal). Auth gerekli.
app.get("/api/komuta/facets", async (c) => {
  try {
    await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    return c.json(await getKomutaFacets());
  } catch (err) {
    console.error("[/api/komuta/facets] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// TAM yenileme — "Veriyi Yenile" butonunun çağırdığı tek endpoint. now-anchor'ı
// yeniden çözer + komuta (tl/9le) + TÜM V3 snapshot'larını + harita aynasını
// aynı taze anchor'la ısıtır. Böylece cockpit ve yönetim/marka/... ekranları
// AYNI ciro/pencereyi gösterir (eski davranış: yalnız komuta tazeleniyordu →
// ekranlar arası tutarsızlık + bayat "son güncelleme"). Merkez kapsam ısıtılır;
// dist-scope snapshot'ları bu taze ham bundle'dan JS'te türetilir.
app.post("/api/refresh-all", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  // Ağır tam-yenileme yalnızca admin: normal kullanıcılar datayı yoramasın.
  if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
  if (DEMO_DATA) return c.json({ ok: true, skipped: "demo" });
  try {
    // Manuel yenileme HIZLI olmalı (server-action → fetch timeout'una düşmesin,
    // "unexpected response"). İki daraltma:
    //  1) dist-scope ısıtma ATLANIR (gece 03:00 / boot işi).
    //  2) TÜM merkez scope'lar (16 kullanıcı) yerine YALNIZ tıklayan admin'in
    //     kendi Panorama scope'u ısıtılır — göreceği tam o scope; brief dahil.
    // Gece/boot job'ı listMerkezScopes ile hepsini kapsamaya devam eder.
    const scope = resolveTenantScope(session, null);
    await refreshAllSnapshots("manual", {
      warmDistScopes: false,
      merkezScopes: [scope.distKods],
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error("[/api/refresh-all] failed:", err);
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Insider Konfigüratörü — /api/admin/config/* (Faz A Dalga 2)
//
// `createAdminGate` merkezi middleware'i (yukarıda, `/api/admin/*`) zaten
// oturum + admin rolünü kapatıyor — burada TEKRAR `isAdminUser` çağrılmaz.
//
// Tüm iş mantığı `packages/core/src/tenant/{customer-breakdown-config-service,
// db-connection-config}.ts`'te — bu handler'lar İNCE: parse → servis çağır →
// dön. Servis katmanı gerçek MSSQL'e bağlanmadan (`runReadOnly`/`connectFn`
// enjeksiyonuyla) unit-testlenir; buradaki tek "gerçek" bağımlılık production
// wiring'i (`runReadOnly`, `connectWithMssql`).
// ---------------------------------------------------------------------------

const CustomerBreakdownInputBody = z.object({
  table: z.string().min(1),
  joinColumn: z.string().min(1),
  labelColumn: z.string().min(1),
});

// GET — mevcut kırılım + küratörlü aday listesi (her biri canlı VAR/YOK).
app.get("/api/admin/config/customer-breakdown", async (c) => {
  try {
    return c.json(await getCustomerBreakdownConfigMeta(runReadOnly));
  } catch (err) {
    console.error("[/api/admin/config/customer-breakdown GET] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST preview — seçilen aday için canlı önizleme (örnek değer + match-rate +
// tip bayrağı). Henüz DİSKE HİÇBİR ŞEY YAZMAZ — salt-okunur bir "dene" adımı.
app.post("/api/admin/config/customer-breakdown/preview", async (c) => {
  try {
    const body = CustomerBreakdownInputBody.extend({
      sampleLimit: z.number().int().min(1).max(50).optional(),
    }).parse(await c.req.json());
    const preview = await previewCustomerBreakdownCandidate(
      runReadOnly,
      { table: body.table, joinColumn: body.joinColumn, labelColumn: body.labelColumn },
      body.sampleLimit,
    );
    return c.json(preview);
  } catch (err) {
    // `resolveCustomerBreakdown` allowlist-dışı girdide THROW eder — bu da
    // burada 400'e çevrilir (istemci hatası, sunucu hatası değil).
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST kaydet — allowlist + canlı-şema doğrulaması geçmezse 422 (bozuk config
// diske YAZILMAZ); geçerse atomik yaz → senkron cache invalidate → audit.
app.post("/api/admin/config/customer-breakdown", async (c) => {
  try {
    const body = CustomerBreakdownInputBody.parse(await c.req.json());
    await saveCustomerBreakdownOverride({
      run: runReadOnly,
      tenantId: getTenantConfig().id,
      actor: c.get("adminUsername"),
      input: body,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof LiveSchemaValidationError) {
      return c.json({ error: err.message, check: err.check }, 422);
    }
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST reset — override'ı kaldır (config dosyasındaki default'a dön).
app.post("/api/admin/config/customer-breakdown/reset", async (c) => {
  try {
    await resetCustomerBreakdownOverride({
      tenantId: getTenantConfig().id,
      actor: c.get("adminUsername"),
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/config/customer-breakdown/reset] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Insider Konfigüratörü — /api/admin/config/product-breakdown/* (Faz B Dalga 1)
//
// `customer-breakdown` endpoint'leriyle AYNI kalıp — bkz. yukarıdaki dosya-üstü
// not. İş mantığı `packages/core/src/tenant/product-breakdown-config-service.ts`.
// ---------------------------------------------------------------------------

const ProductBreakdownInputBody = z.object({
  table: z.string().min(1),
  joinColumn: z.string().min(1),
  labelColumn: z.string().min(1),
});

// GET — mevcut ürün/marka kırılımı + küratörlü aday listesi (canlı VAR/YOK).
app.get("/api/admin/config/product-breakdown", async (c) => {
  try {
    return c.json(await getProductBreakdownConfigMeta(runReadOnly));
  } catch (err) {
    console.error("[/api/admin/config/product-breakdown GET] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST preview — seçilen aday için canlı önizleme. DİSKE HİÇBİR ŞEY YAZMAZ.
app.post("/api/admin/config/product-breakdown/preview", async (c) => {
  try {
    const body = ProductBreakdownInputBody.extend({
      sampleLimit: z.number().int().min(1).max(50).optional(),
    }).parse(await c.req.json());
    const preview = await previewProductBreakdownCandidate(
      runReadOnly,
      { table: body.table, joinColumn: body.joinColumn, labelColumn: body.labelColumn },
      body.sampleLimit,
    );
    return c.json(preview);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST kaydet — allowlist + canlı-şema doğrulaması geçmezse 422; geçerse
// atomik yaz → senkron cache invalidate → audit.
app.post("/api/admin/config/product-breakdown", async (c) => {
  try {
    const body = ProductBreakdownInputBody.parse(await c.req.json());
    await saveProductBreakdownOverride({
      run: runReadOnly,
      tenantId: getTenantConfig().id,
      actor: c.get("adminUsername"),
      input: body,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof LiveSchemaValidationError) {
      return c.json({ error: err.message, check: err.check }, 422);
    }
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST reset — override'ı kaldır (config dosyasındaki default'a dön).
app.post("/api/admin/config/product-breakdown/reset", async (c) => {
  try {
    await resetProductBreakdownOverride({
      tenantId: getTenantConfig().id,
      actor: c.get("adminUsername"),
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/config/product-breakdown/reset] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Insider Konfigüratörü — /api/admin/config/region-breakdown/* (Faz B Dalga 1)
//
// `customer-breakdown` endpoint'leriyle AYNI kalıp. İş mantığı
// `packages/core/src/tenant/region-breakdown-config-service.ts`.
// ---------------------------------------------------------------------------

const RegionBreakdownInputBody = z.object({
  table: z.string().min(1),
  joinColumn: z.string().min(1),
  labelColumn: z.string().min(1),
});

// GET — mevcut bölge kırılımı + küratörlü aday listesi (canlı VAR/YOK).
app.get("/api/admin/config/region-breakdown", async (c) => {
  try {
    return c.json(await getRegionBreakdownConfigMeta(runReadOnly));
  } catch (err) {
    console.error("[/api/admin/config/region-breakdown GET] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST preview — seçilen aday için canlı önizleme. DİSKE HİÇBİR ŞEY YAZMAZ.
app.post("/api/admin/config/region-breakdown/preview", async (c) => {
  try {
    const body = RegionBreakdownInputBody.extend({
      sampleLimit: z.number().int().min(1).max(50).optional(),
    }).parse(await c.req.json());
    const preview = await previewRegionBreakdownCandidate(
      runReadOnly,
      { table: body.table, joinColumn: body.joinColumn, labelColumn: body.labelColumn },
      body.sampleLimit,
    );
    return c.json(preview);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST kaydet — allowlist + canlı-şema doğrulaması geçmezse 422; geçerse
// atomik yaz → senkron cache invalidate → audit.
app.post("/api/admin/config/region-breakdown", async (c) => {
  try {
    const body = RegionBreakdownInputBody.parse(await c.req.json());
    await saveRegionBreakdownOverride({
      run: runReadOnly,
      tenantId: getTenantConfig().id,
      actor: c.get("adminUsername"),
      input: body,
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof LiveSchemaValidationError) {
      return c.json({ error: err.message, check: err.check }, 422);
    }
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST reset — override'ı kaldır (config dosyasındaki default'a dön).
app.post("/api/admin/config/region-breakdown/reset", async (c) => {
  try {
    await resetRegionBreakdownOverride({
      tenantId: getTenantConfig().id,
      actor: c.get("adminUsername"),
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/config/region-breakdown/reset] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Insider Konfigüratörü — /api/admin/config/tenant* (Faz A Dalga 1, kodsuz
// tenant onboarding — kimlik: id/displayName/labels/strategicBrands/
// industry/tax; DB creds Dalga 2'de kalır, bu uçlara DOKUNMADI).
//
// İş mantığı `packages/core/src/tenant/tenant-config-service.ts`'te. GET
// PARAMETRESİZ — daima `getTenantConfig().id` (server-otoriter, Faz 0 şart).
// POST `id`'yi body'de bekler ama Security LOW sertleştirmesiyle (Faz A
// Dalga 2) YALNIZ aktif tenant'ın id'sini kabul eder (aşağıdaki kontrol) —
// keyfi bir id için "hayalet" tanım yazımı artık MÜMKÜN DEĞİL. POST-reset
// `id`'yi body'den alır, o da YALNIZ hangi tanım DOSYASININ silineceğini
// seçer — aktif tenant'ı (`process.env.TENANT`) hiçbiri DEĞİŞTİRMEZ.
//
// `TenantLabelsBody`/`TenantTaxBody`/`TenantDefinitionBody`/`DbConnectionBody`
// şemaları YUKARIDA (setup bölümünde) tanımlı — burada tekrar EDİLMEZ (Metz
// DRY); setup akışı AYNI şemaları `.omit({id:true})` ile kullanır.
// ---------------------------------------------------------------------------

// GET — aktif tenant'ın kimlik tanımı (REGISTRY-yönetimli ise definition/config null).
app.get("/api/admin/config/tenant", (c) => {
  try {
    return c.json(getActiveTenantDefinitionMeta());
  } catch (err) {
    console.error("[/api/admin/config/tenant GET] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST — tenant tanımını oluştur/güncelle. Security LOW (Faz A Dalga 2):
// `id` AKTİF tenant'la eşleşmezse 400 — aktif tenant dışında keyfi bir id
// yazımı kapatılır (`isActiveTenantId`, `tenant-config-service.ts`). Zorunlu-
// alan + REGISTRY-çakışma doğrulaması başarısızsa 400 (bozuk/çakışan tanım
// diske YAZILMAZ); geçerse atomik yaz → senkron `clearTenantCache()` →
// audit ("create-tenant" ilk yazımda, "update-tenant" var olan bir tanımın
// üstüne yazılırken).
app.post("/api/admin/config/tenant", async (c) => {
  try {
    const body = TenantDefinitionBody.parse(await c.req.json());
    if (!isActiveTenantId(body.id)) {
      return c.json(
        { error: `id "${body.id}" aktif tenant ("${getTenantConfig().id}") ile eşleşmiyor — yalnız aktif tenant düzenlenebilir.` },
        400,
      );
    }
    const config = await saveTenantDefinitionOverride({
      actor: c.get("adminUsername"),
      input: body,
    });
    return c.json({ ok: true, config });
  } catch (err) {
    if (err instanceof TenantValidationError) {
      return c.json({ error: err.message, issues: err.issues }, 400);
    }
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST reset — belirtilen id'nin tanım dosyasını kaldırır (idempotent).
app.post("/api/admin/config/tenant/reset", async (c) => {
  let id: string;
  try {
    id = z.object({ id: z.string().min(1) }).parse(await c.req.json()).id;
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  try {
    await resetTenantDefinitionOverride({ id, actor: c.get("adminUsername") });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof TenantIdError) {
      return c.json({ error: err.message }, 400);
    }
    console.error("[/api/admin/config/tenant/reset] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// GET — maskeli görünüm: parola ASLA dönmez (yalnız hasPassword boolean).
app.get("/api/admin/config/db-connection", (c) => {
  try {
    return c.json(getDbConnectionMeta(getTenantConfig().id));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST test — Security H2: ham mssql hatası ASLA dönmez, yalnız {ok}.
app.post("/api/admin/config/db-connection/test", async (c) => {
  try {
    const body = DbConnectionBody.parse(await c.req.json());
    return c.json(await testDbConnection(connectWithMssql, body));
  } catch (err) {
    // Buraya yalnız zod parse hatası (body şekli bozuk) düşer — gerçek
    // bağlantı hatası `testDbConnection` içinde zaten yutulup sanitize edildi.
    return c.json({ error: (err as Error).message }, 400);
  }
});

// POST — creds'i şifreli (AES-256-GCM) yaz; parola write-only (bu endpoint
// hiçbir zaman parolayı GERİ döndürmez, yalnız {ok}) + aktif pool'u kapat
// (GÖREV 1: bir sonraki `getPool()` yeni creds'le taze bağlantı açar).
app.post("/api/admin/config/db-connection", async (c) => {
  try {
    const body = DbConnectionBody.parse(await c.req.json());
    await saveDbConnectionOverride({
      tenantId: getTenantConfig().id,
      actor: c.get("adminUsername"),
      input: body,
    });
    await closePool().catch(() => undefined);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// --- Admin: çok-DB (login'de DB seçimi) — kodsuz yönetim -------------------
// Aynı sunucu/kimlik, farklı `database`. Liste sır değil (etiket + DB adı) →
// meta olduğu gibi döner. Kayıtta `closePool()`: bir dbId'nin database adı
// değişmişse eski havuz taze değeri yakalasın (db-connection ile aynı desen).
app.get("/api/admin/config/databases", (c) => {
  try {
    return c.json({ databases: getDatabasesConfig(getTenantConfig().id) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post("/api/admin/config/databases", async (c) => {
  try {
    const body = (await c.req.json()) as { databases?: unknown };
    const saved = await saveDatabasesOverride({
      tenantId: getTenantConfig().id,
      actor: c.get("adminUsername"),
      databases: body.databases,
    });
    await closePool().catch(() => undefined);
    return c.json({ ok: true, databases: saved });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// --- Admin: kullanıcı yetkileri (ekran + şehir) — yalnız merkez rolü --------
// Yetkiler DB'ye yazılamaz (salt-okunur) → JSON store (user-perms.ts).
app.get("/api/admin/perms", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
  return c.json({ perms: getAllPerms() });
});

app.post("/api/admin/perms", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
  try {
    const body = (await c.req.json()) as {
      username?: string;
      admin?: boolean;
      screens?: string[] | null;
      dists?: number[] | null;
      cities?: string[] | null;
    };
    const username = (body.username ?? "").trim();
    if (!username) return c.json({ error: "username gerekli" }, 400);
    // Panorama-otoritesi: admin YALNIZCA kendi yetkili olduğu distribütörleri
    // atayabilir. Kapsam dışı dist gönderilirse sessizce elenir (sunucu-otoriter).
    let dists: number[] | null = null;
    if (body.dists != null) {
      const allowed = new Set(session.allowedDistKods);
      dists = body.dists.filter((d) => Number.isInteger(d) && allowed.has(d));
    }
    // Admin yetkisi grantable — bir admin başka kullanıcıya admin verebilir
    // (endpoint zaten admin-gate'li). Verilen kişi de aynı işi yapabilir.
    const perms = setUserPerm(username, {
      admin: !!body.admin,
      screens: body.screens ?? null,
      dists,
      cities: body.cities ?? null,
    });
    return c.json({ ok: true, perms });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post("/api/admin/perms/delete", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
  try {
    const body = (await c.req.json()) as { username?: string };
    const username = (body.username ?? "").trim();
    if (!username) return c.json({ error: "username gerekli" }, 400);
    return c.json({ ok: true, perms: deleteUserPerm(username) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Şehir listesi (yetki atama dropdown'u) — TBLMUSTERI'den distinct TXTSEHIR.
app.get("/api/admin/cities", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
  try {
    const r = await runReadOnly(
      "SELECT DISTINCT LTRIM(RTRIM(TXTSEHIR)) AS sehir FROM dbo.TBLMUSTERI " +
        "WHERE BYTDURUM = 0 AND TXTSEHIR IS NOT NULL AND LTRIM(RTRIM(TXTSEHIR)) <> '' " +
        "ORDER BY sehir",
      { limit: 500, timeoutMs: 20_000 },
    );
    return c.json({ cities: r.rows.map((x) => String(x.sehir)) });
  } catch (err) {
    return c.json({ error: (err as Error).message, cities: [] }, 200);
  }
});

// Distribütör listesi (yetki atama) — PANORAMA-OTORİTESİ: yalnızca giriş yapan
// admin'in kendi yetkili olduğu distribütörler (login'de ERCVIEWTBLKULLANICIDIST_
// DASHBOARD view'ından çözülen allowedDistKods). Admin bu kümenin dışına
// kullanıcı yetkilendiremez (POST /api/admin/perms sunucu tarafında da eler).
app.get("/api/admin/dists", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
  try {
    const dists = await listAllowedDistributors(session);
    return c.json({ dists });
  } catch (err) {
    return c.json({ error: (err as Error).message, dists: [] }, 200);
  }
});

// Kullanıcı listesi (yetki atama) — yeni hesap AÇILMAZ; yetkiler yalnızca
// PANORAMA'daki mevcut kullanıcılara atanır. Giriş politikası merkez-only
// olduğu için yalnızca BYTTIP=0 (merkez) aktif kullanıcılar listelenir.
app.get("/api/admin/users", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
  if (DEMO_DATA) return c.json({ users: [] });
  try {
    const r = await runReadOnly(
      "SELECT TXTKULLANICIISIM AS uname, TXTADSOYAD AS ad FROM dbo.TBLKULLANICI " +
        "WHERE BYTDURUM = 0 AND BYTTIP = 0 AND TXTKULLANICIISIM IS NOT NULL " +
        "ORDER BY TXTKULLANICIISIM",
      { limit: 2000, timeoutMs: 20_000 },
    );
    const users = r.rows.map((x) => ({
      username: String(x.uname).trim(),
      displayName: x.ad == null ? null : String(x.ad).trim(),
    }));
    return c.json({ users });
  } catch (err) {
    return c.json({ error: (err as Error).message, users: [] }, 200);
  }
});

// Wietnauer Yönetim Kurulu Dashboard (Faz A) — Top müşteri, marka katkısı,
// iskonto KPI. Tenant'tan stratejik marka listesi alınıp marka panelinde
// vurgulanır.
app.get("/api/wietnauer/yonetim", async (c) => {
  let scope: TenantScope;
  try {
    const distIdRaw = c.req.query("distId");
    const distIdParsed = distIdRaw != null && distIdRaw !== "" ? Number(distIdRaw) : null;
    const requestedDistId = distIdParsed != null && Number.isFinite(distIdParsed) ? distIdParsed : null;
    scope = await scopeFromRequest(c, requestedDistId);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const forceRefresh = !DEMO_DATA && c.req.query("refresh") === "1";
    const tenant = getTenantConfig();
    const { dateFrom, dateTo } = parseDateRange(c);
    const snap = await getWietnauerYonetimSnapshot({
      forceRefresh,
      strategicBrands: tenant.strategicBrands ?? [],
      allowedDistKods: scope.distKods,
      distId: scopeSingleDistId(scope),
      allowedCities: scope.cities,
      dateFrom,
      dateTo,
    });
    return c.json(maskDemoSnapshot(snap));
  } catch (err) {
    console.error("[/api/wietnauer/yonetim] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// V3 Dashboards #2-#7 — paralel agent'lar tarafından dolduruluyor.
//
// GÜVENLİK: her v3 endpoint auth ister (401 if no session) ve TenantScope'u
// snapshot fonksiyonuna geçirir. `allowedDistKods`:
//   - merkez → null (tüm distribütörler)
//   - dist   → izinli dist kodları (yalnızca kendi verisi)
// `distId` merkez drill-down / dist tek-dist seçimi. Snapshot fonksiyonları
// bu iki alanı uygulayarak dist izolasyonunu sağlar.
type V3SnapshotOpts = {
  forceRefresh?: boolean;
  strategicBrands?: string[];
  allowedDistKods?: number[] | null;
  distId?: number | null;
  allowedCities?: string[] | null;
  /** Faz 3 — tarih aralığı filtresi (YYYY-MM-DD). Verilmezse fetcher'ın
   *  varsayılan penceresi (ör. son 30g) kullanılır. */
  dateFrom?: string | null;
  dateTo?: string | null;
};

/**
 * md2 — Dönem preset'ini (`?donem=mtd|ytd|q1|q2|q3`) DONUK-SAAT anchor'ına
 * (NOW_MODE=max-invoice) göre from/to'ya çevirir. Preset'ler client'ta değil
 * BURADA çözülür — böylece "bugün" değil, verinin son gününe (anchor) göre
 * hesaplanır ve tüm ekranlar tutarlı pencere görür. `son30g` / bilinmeyen →
 * null (fetcher'ın varsayılan son-30g penceresi).
 */
function anchorToday(): string {
  return (
    nowAnchorDate() ??
    process.env.DEMO_DATE?.trim() ??
    new Date().toISOString().slice(0, 10)
  );
}
function resolveDonem(donem: string): { from: string; to: string } | null {
  const a = anchorToday(); // YYYY-MM-DD
  const yr = a.slice(0, 4);
  switch (donem) {
    case "mtd":
      return { from: `${a.slice(0, 7)}-01`, to: a };
    case "ytd":
      return { from: `${yr}-01-01`, to: a };
    case "q1":
      return { from: `${yr}-01-01`, to: `${yr}-03-31` };
    case "q2":
      return { from: `${yr}-04-01`, to: `${yr}-06-30` };
    case "q3":
      return { from: `${yr}-07-01`, to: `${yr}-09-30` };
    default:
      return null; // son30g / bilinmeyen → varsayılan pencere
  }
}

/**
 * ?from&to (serbest, öncelikli) VEYA ?donem preset'ini çözer. İkisi de yoksa
 * null → fetcher varsayılan penceresi.
 */
function parseDateRange(c: { req: { query: (k: string) => string | undefined } }): {
  dateFrom: string | null;
  dateTo: string | null;
} {
  const norm = (v: string | undefined): string | null => {
    const s = (v ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const from = norm(c.req.query("from"));
  const to = norm(c.req.query("to"));
  if (from && to) return { dateFrom: from, dateTo: to }; // serbest aralık öncelikli
  const donem = (c.req.query("donem") ?? "").trim().toLowerCase();
  if (donem && donem !== "son30g") {
    const r = resolveDonem(donem);
    if (r) return { dateFrom: r.from, dateTo: r.to };
  }
  return { dateFrom: null, dateTo: null };
}
function makeV3Handler(
  name: string,
  fn: (o: V3SnapshotOpts) => Promise<unknown>,
) {
  return async (c: {
    req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined };
    json: (...args: unknown[]) => Response;
  }) => {
    let scope: TenantScope;
    try {
      const distIdRaw = c.req.query("distId");
      const parsed = distIdRaw != null && distIdRaw !== "" ? Number(distIdRaw) : null;
      const requestedDistId = parsed != null && Number.isFinite(parsed) ? parsed : null;
      scope = await scopeFromRequest(c, requestedDistId);
    } catch (err) {
      if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
      return c.json({ error: (err as Error).message }, 500);
    }
    try {
      const forceRefresh = !DEMO_DATA && c.req.query("refresh") === "1";
      const tenant = getTenantConfig();
      const { dateFrom, dateTo } = parseDateRange(c);
      const snap = await fn({
        forceRefresh,
        strategicBrands: tenant.strategicBrands ?? [],
        allowedDistKods: scope.distKods,
        distId: scopeSingleDistId(scope),
        allowedCities: scope.cities,
        dateFrom,
        dateTo,
      });
      return c.json(maskDemoSnapshot(snap));
    } catch (err) {
      console.error(`[/api/wietnauer/${name}] failed:`, err);
      return c.json({ error: (err as Error).message }, 500);
    }
  };
}
// @ts-expect-error — Hono context tip uyumu; runtime'da çalışır.
app.get("/api/wietnauer/marka", makeV3Handler("marka", getWietnauerMarkaSnapshot));
// @ts-expect-error
app.get("/api/wietnauer/aktivasyon", makeV3Handler("aktivasyon", getWietnauerAktivasyonSnapshot));
// @ts-expect-error
app.get("/api/wietnauer/iskonto", makeV3Handler("iskonto", getWietnauerIskontoSnapshot));
// @ts-expect-error
app.get("/api/wietnauer/segment", makeV3Handler("segment", getWietnauerSegmentSnapshot));
// @ts-expect-error
app.get("/api/wietnauer/saha", makeV3Handler("saha", getWietnauerSahaSnapshot));
// @ts-expect-error
app.get("/api/wietnauer/satis", makeV3Handler("satis", getWietnauerSatisSnapshot));
// Stok endpoint'i distId query param'ı (merkez drill-down) + yetki kapsamı
// destekler. Dist kullanıcı yalnızca kendi dist(ler)ini görür; başka distId
// gönderse bile scope JWT'den zorlanır (sunucu-otoriter).
app.get("/api/wietnauer/stok", async (c) => {
  let scope: TenantScope;
  try {
    const distIdRaw = c.req.query("distId");
    const distIdParsed = distIdRaw != null && distIdRaw !== "" ? Number(distIdRaw) : null;
    const requestedDistId = distIdParsed != null && Number.isFinite(distIdParsed) ? distIdParsed : null;
    scope = await scopeFromRequest(c, requestedDistId);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const forceRefresh = !DEMO_DATA && c.req.query("refresh") === "1";
    const tenant = getTenantConfig();
    const { dateFrom, dateTo } = parseDateRange(c);
    const snap = await getWietnauerStokSnapshot({
      forceRefresh,
      strategicBrands: tenant.strategicBrands ?? [],
      // merkez tam görünürlük → allowedDistKods null; dist → izinli liste.
      allowedDistKods: scope.distKods,
      // merkez drill-down / dist tek-dist seçimi → scope'tan tek dist.
      distId: scopeSingleDistId(scope),
      allowedCities: scope.cities,
      dateFrom,
      dateTo,
    });
    return c.json(maskDemoSnapshot(snap));
  } catch (err) {
    console.error("[/api/wietnauer/stok] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Finans Agentı — bölge YoY anomalisini decompose eden Gemini analizi.
// `region` path segment: TBLDIST.TXTGRUP değeri (case-insensitive eşleştirilir).
//
// GÜVENLİK: auth ister (401 if no session). Dist kullanıcı bir bölgeyi
// açtığında sadece KENDİ dist'inin o bölgedeki dilimini görür.
app.get("/api/komuta/finance/:region", async (c) => {
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const region = decodeURIComponent(c.req.param("region") ?? "").trim();
    if (!region) return c.json({ error: "region parametresi boş." }, 400);
    const forceRefresh = !DEMO_DATA && c.req.query("refresh") === "1";
    // productGroup query param — heatmap hücresinden gelir; verilirse
    // analiz o ürün grubuyla filtrelenir.
    const productGroup =
      c.req.query("productGroup")?.trim() || undefined;
    const analysis = await analyzeRegionAnomaly(region, {
      forceRefresh,
      productGroup,
      allowedDistKods: scope.distKods,
    });
    return c.json(analysis);
  } catch (err) {
    console.error("[/api/komuta/finance] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Cache observability + manual wipe. GET → stats per domain; DELETE → clear.
// Lets us wire a global "tüm cache'i temizle" affordance later if needed.
//
// GÜVENLİK (LOW ek): guard yukarıda oturum zorunlu kılıyor ama rol kontrolü
// yoktu — herhangi bir dist kullanıcı diğer tüm tenant'ların/dashboard'ların
// cache'ini görebiliyor/silebiliyordu. Merkez-only'e indirgendi.
app.get("/api/cache", async (c) => {
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  if (scope.type !== "merkez") {
    return c.json({ error: "Bu işlem yalnızca merkez kullanıcılara açık" }, 403);
  }
  try {
    return c.json({ entries: cacheStats() });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.delete("/api/cache/:domain", async (c) => {
  let scope: TenantScope;
  try {
    scope = await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  if (scope.type !== "merkez") {
    return c.json({ error: "Bu işlem yalnızca merkez kullanıcılara açık" }, 403);
  }
  try {
    const domain = c.req.param("domain");
    const cleared = cachedClear(domain);
    return c.json({ cleared });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const PORT = parseInt(process.env.API_PORT ?? "8080", 10);
// Varsayılan yalnız-localhost bind — Next köprüsü (aynı makine) erişir, dış
// ağ kapalı. Kasıtlı olarak dışa açmak isteyen API_HOST=0.0.0.0 verir.
const HOST = process.env.API_HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port: PORT, hostname: HOST });
console.log(`[enroute-api] listening on http://${HOST}:${PORT}`);

// ---------------------------------------------------------------------------
// GECE CRON — saha dışında snapshot warm-up
// ---------------------------------------------------------------------------
// Prod saha satıcıları 09:00-19:00 aktif; gece 03:00'te MSSQL en boş.
// Bu saatte Komuta snapshot + TBLMUSTERI mirror refresh ediliyor → gün
// boyu kullanıcı warm cache hit'i alır, prod DB'ye gün içi heavy query
// gitmez.
//
// Cron yok (Node), 24 saatte bir tetiklenen setInterval ile çözdük. Server
// restart'ında bir sonraki 03:00'e kadar bekler — manuel "Veriyi Yenile"
// her zaman fallback olarak elimizde.
const NIGHT_REFRESH_HOUR = parseInt(
  process.env.NIGHT_REFRESH_HOUR ?? "3",
  10,
);

function msUntilNextNightRefresh(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(NIGHT_REFRESH_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    // Bugünün 03:00 geçti, yarına çevir
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

// Tüm merkez-kapsam cache'lerini tek seferde tazeler: komuta + V3 snapshot'ları
// + harita müşteri aynası. Hem gece job'ı hem açılış warm'ı bunu çağırır.
// Dist-kullanıcı kapsamları (allowedDistKods dolu) ilk istekte lazy üretilir —
// nadir olduğu için job'da toplu tazelemeye gerek yok.
// Bir warm adımını izole eder: başla/bitti(ms) logu + hata yakalama + timeout.
// Böylece tek bir yavaş/hatalı snapshot zinciri bloke edemez ve log tam olarak
// hangisinin nerede takıldığını gösterir.
async function warmStep(
  tag: string,
  name: string,
  fn: () => Promise<unknown>,
  timeoutMs = 90_000,
): Promise<void> {
  const t0 = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`warm timeout ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    console.log(`${tag} ${name} ok (${Date.now() - t0}ms)`);
  } catch (err) {
    console.error(`${tag} ${name} fail (${Date.now() - t0}ms):`, (err as Error).message);
  }
}

async function refreshAllSnapshots(
  reason: string,
  opts: {
    warmDistScopes?: boolean;
    // Manuel yenilemede yalnız tıklayan admin'in KENDİ merkez scope'unu ısıtırız
    // (hızlı + göreceği tam o scope). Verilmezse (gece/boot) TÜM merkez scope'lar
    // listMerkezScopes ile çözülür. Her eleman bir Panorama dist kümesi (null=all).
    merkezScopes?: Array<number[] | null>;
  } = {},
) {
  const tag = `[refresh:${reason}]`;
  console.log(`${tag} başlıyor (${new Date().toISOString()})`);
  const tenant = getTenantConfig();
  const merkezOpts: V3SnapshotOpts = {
    forceRefresh: true,
    strategicBrands: tenant.strategicBrands ?? [],
    allowedDistKods: null, // merkez → tam görünürlük
    distId: null,
  };
  try {
    // 0) "now" anchor'ını çöz (NOW_MODE=max-invoice) — snapshot'lar doğru
    //    pencereyle hesaplansın diye HER ŞEYDEN ÖNCE.
    await resolveNowAnchor().catch((err) => {
      console.error(`${tag} now-anchor fail:`, (err as Error).message);
    });

    // Merkez kullanıcıların GERÇEK dist küme(leri). resolveTenantScope merkez
    // için bile distKods'u Panorama kümesi olarak döndürür (null=filtresiz
    // DEĞİL); cockpit/V3 bu AÇIK listeyle çağırıyor → cache anahtarı "d1_4..._31".
    // Warm eskiden allowedDistKods geçmiyordu → "all" anahtarını ısıtıyordu ve
    // cockpit'in okuduğu anahtara HİÇ dokunmuyordu (AI brief boş, ilk açılış
    // cache-miss). Artık warm cockpit ile AYNI anahtar(lar)ı ısıtır. Kümeler
    // alınamazsa null=merkez-filtresiz'e düşülür (eski davranış — bozulmaz).
    const merkezScopes =
      opts.merkezScopes ??
      (await listMerkezScopes().catch((err) => {
        console.error(`${tag} listMerkezScopes fail:`, (err as Error).message);
        return [] as number[][];
      }));
    const warmScopes: Array<number[] | null> =
      merkezScopes.length > 0 ? merkezScopes : [null];
    console.log(
      `${tag} merkez scope: ${warmScopes.length} küme (${warmScopes
        .map((s) => (s ? `${s.length} dist` : "all"))
        .join(", ")})`,
    );

    // 1) Harita müşteri aynası — "Verileri yenile" ile aynı sync. KOMUTA/V3
    //    WARM'INDAN ÖNCE çalışmalı: syncMapData sonunda cachedClear("komuta"/
    //    "foresight"/"customer-detail") çağırıyor. Eskiden map sync komuta
    //    warm'ından SONRA geliyordu → taze komuta brief'ini siliyordu, sonraki
    //    cockpit yüklemesi boş brief üretiyordu ("yenileyince brief kayboluyor").
    //    Önce temizle, SONRA ısıt → brief kalıcı. Ayrıca invalidateKomuta:false:
    //    komuta'yı map sync değil, hemen aşağıdaki forceRefresh warm tazeler; map
    //    sync ayrıca komuta'yı silmemeli (manuel yenilemede diğer merkez scope'ların
    //    brief'ini uçurur — manuel yalnız caller scope'unu ısıtır).
    await warmStep(tag, "map sync", () =>
      syncMapData(REPO_ROOT, { invalidateKomuta: false }),
    );

    // 2) Komuta (TL + 9L) — her merkez scope için (cockpit anahtarıyla eşleşir)
    for (const scope of warmScopes) {
      const label = scope ? `d${scope.length}` : "all";
      for (const unit of ["tl", "9le"] as const) {
        await warmStep(tag, `komuta ${unit} [${label}]`, () =>
          getKomutaSnapshot({ forceRefresh: true, unit, allowedDistKods: scope }),
        );
      }
    }

    // 3) V3 snapshot'ları — aynı merkez scope(lar) ile. Bunlar daha önce gece
    //    job'ında tazelenMİYORdu; "son güncelleme" bu yüzden ilk hesap tarihinde
    //    donuyordu. Ayrıca yanlış (all) anahtarda ısınıyordu → merkez ilk açılış
    //    cache-miss. Artık cockpit anahtarıyla eşleşir.
    const v3: Array<[string, (o: V3SnapshotOpts) => Promise<unknown>]> = [
      ["yonetim", getWietnauerYonetimSnapshot],
      ["marka", getWietnauerMarkaSnapshot],
      ["aktivasyon", getWietnauerAktivasyonSnapshot],
      ["iskonto", getWietnauerIskontoSnapshot],
      ["segment", getWietnauerSegmentSnapshot],
      ["saha", getWietnauerSahaSnapshot],
      ["satis", getWietnauerSatisSnapshot],
      ["stok", getWietnauerStokSnapshot],
    ];
    for (const scope of warmScopes) {
      const label = scope ? `d${scope.length}` : "all";
      for (const [name, fn] of v3) {
        await warmStep(tag, `v3 ${name} [${label}]`, () =>
          fn({ ...merkezOpts, allowedDistKods: scope }),
        );
      }
    }

    // 4) Dist scope ısıtma — merkez drilldown ve tek-dist kullanıcıların cache
    //    anahtarı { distId: X }'tir; merkez (null) ısıtma bunları kapsamaz.
    //    En aktif dist'leri hacme göre seçip (hepsini değil) komuta + tüm V3
    //    snapshot'larını o scope'ta ısıtırız. WARM_DIST_SCOPES=0 ile kapatılır;
    //    WARM_DIST_LIMIT ile dist sayısı ayarlanır (03:00 job süresi / MSSQL yükü).
    // Dist scope ısıtma yalnız gece/boot'ta (ağır — ~20 dist × komuta+V3).
    // Manuel "Veriyi Yenile" (HTTP isteği) bunu ATLAR; yoksa istek dakikalarca
    // sürüp server-action timeout'una düşer ("unexpected response"). Manuel
    // yenileme merkez + V3 + harita ile hızlı tamamlanır; dist'ler gece ısınır.
    if (opts.warmDistScopes !== false && process.env.WARM_DIST_SCOPES !== "0") {
      const distLimit = parseInt(process.env.WARM_DIST_LIMIT ?? "25", 10);
      const distIds = await listTopActiveDistIds(distLimit).catch((err) => {
        console.error(`${tag} dist listesi fail:`, (err as Error).message);
        return [] as number[];
      });
      console.log(`${tag} dist scope ısıtma: ${distIds.length} dist (limit ${distLimit})`);
      for (const distId of distIds) {
        const distOpts: V3SnapshotOpts = {
          forceRefresh: true,
          strategicBrands: tenant.strategicBrands ?? [],
          allowedDistKods: null,
          distId,
        };
        // Komuta yalnız TL (9LE merkez'de ısıtıldı; dist başına maliyeti sınırla).
        await warmStep(tag, `komuta d${distId}`, () =>
          getKomutaSnapshot({ forceRefresh: true, unit: "tl", distId }),
        );
        for (const [name, fn] of v3) {
          await warmStep(tag, `v3 ${name} d${distId}`, () => fn(distOpts));
        }
      }
    }

    console.log(`${tag} başarılı (${new Date().toISOString()})`);
  } catch (err) {
    console.error(`${tag} beklenmeyen hata:`, err);
  }
}

/**
 * Warm'ı TÜM seçilebilir veritabanları için çalıştırır (çok-DB kurulumu).
 * Tek-DB tenant'ta (`listSelectableDatabases()` boş) bugünkü davranış birebir:
 * bağlamsız tek çağrı → varsayılan DB. Çok-DB'de her DB kendi bağlamında
 * (`runWithDbId`) ayrı ısıtılır → her biri kendi `<base>-<dbId>.sqlite`
 * cache dosyasına yazar (kullanıcının login'de seçip okuduğu dosya ile aynı).
 * Sırayla (paralel değil) — aynı MSSQL sunucusunu aynı anda boğmamak için.
 */
async function warmAllDatabases(reason: "night" | "startup"): Promise<void> {
  const dbs = listSelectableDatabases();
  if (dbs.length === 0) {
    await refreshAllSnapshots(reason);
    return;
  }
  for (const db of dbs) {
    await runWithDbId(db.id, () => refreshAllSnapshots(reason));
  }
}

async function nightRefresh() {
  await warmAllDatabases("night");
  // Sonraki gün için tekrar planla
  setTimeout(nightRefresh, 24 * 60 * 60 * 1000);
}

// İlk tetikleme — bir sonraki 03:00'e kadar bekle.
// Demo (MSSQL yok) → nightRefresh boş snapshot üretip pre-baked seed cache'ini
// ezer. Bu yüzden demo'da night-refresh HİÇ planlanmaz.
if (DEMO_DATA) {
  console.log("[night-refresh] demo tenant — devre dışı (veri pre-baked)");
} else {
  const initialDelay = msUntilNextNightRefresh();
  const hoursUntil = (initialDelay / 1000 / 60 / 60).toFixed(1);
  console.log(
    `[night-refresh] sonraki refresh ${hoursUntil}h içinde (${NIGHT_REFRESH_HOUR}:00)`,
  );
  setTimeout(nightRefresh, initialDelay);

  // "now" anchor'ını (NOW_MODE=max-invoice) boot'ta HEMEN çöz — 10s warm'ı
  // beklemeden normal istekler de doğru pencereyi (en son fatura günü) alsın.
  void resolveNowAnchor().catch(() => {});

  // Açılış warm'ı — server dinlemeye başladıktan ~10s sonra tüm cache'leri
  // bir kez tazele. Böylece `pm2 restart` = anında güncel veri (V3 dahil),
  // 03:00'ı beklemeden. Boot'u bloklamamak için await edilmez.
  if (process.env.SKIP_STARTUP_WARM !== "1") {
    setTimeout(() => {
      void warmAllDatabases("startup");
    }, 10_000);
  } else {
    console.log("[enroute-api] SKIP_STARTUP_WARM=1 → açılış warm'ı atlandı");
  }
}

process.on("SIGINT", async () => {
  await closePool().catch(() => {});
  process.exit(0);
});
