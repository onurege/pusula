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
import {
  analyzeRegionAnomaly,
  closePool,
  formatRetrievalForPrompt,
  customerInScope,
  getCustomerSales,
  getKomutaSnapshot,
  getMapFacets,
  getWietnauerYonetimSnapshot,
  getWietnauerMarkaSnapshot,
  getWietnauerAktivasyonSnapshot,
  getWietnauerIskontoSnapshot,
  getWietnauerSegmentSnapshot,
  getWietnauerSahaSnapshot,
  getWietnauerSatisSnapshot,
  getWietnauerStokSnapshot,
  getTenantConfig,
  getRadarDefinition,
  getReport,
  getSyncStatus,
  listMapCustomers,
  listMapRegions,
  listMapCityYoY,
  listRadarDefinitions,
  listReports,
  loadSnapshot,
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
  resolveTenantScope,
  listAllowedDistributors,
  AUTH_COOKIE_NAME,
  scopeSingleDistId,
  type TenantScope,
} from "@enroute/core";

const app = new Hono();
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
const DEMO_DATA = getTenantConfig().demoData === true;

async function scopeFromRequest(
  c: { req: { header: (k: string) => string | undefined } },
  selectedDistKod?: number | null,
): Promise<TenantScope> {
  const session = await verifySession(tokenFromRequest(c));
  return resolveTenantScope(session, selectedDistKod ?? null);
}

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
    const body = (await c.req.json()) as { username?: string; password?: string };
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    if (!username || !password) {
      return c.json({ error: "Kullanıcı adı ve şifre gerekli" }, 400);
    }
    const user = await authenticateUser(username, password);
    if (!user) {
      recordRateLimitHit("login", ip, RATE_LIMIT_WINDOW_MS);
      return c.json({ error: "Geçersiz kullanıcı adı veya şifre" }, 401);
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
  return c.json({
    user: {
      userId: session.userId,
      username: session.username,
      displayName: session.displayName,
      role: session.role,
      allowedDistKods: session.allowedDistKods,
    },
  });
});

// GET /api/auth/distributors — kullanıcının izinli distribütörleri (dropdown).
app.get("/api/auth/distributors", async (c) => {
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum bulunamadı" }, 401);
  try {
    const distributors = await listAllowedDistributors(session);
    return c.json({ distributors, role: session.role });
  } catch (err) {
    console.error("[/api/auth/distributors] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
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
]);

app.use("/api/*", async (c, next) => {
  if (PUBLIC_ROUTES.has(c.req.path)) return next();
  const session = await verifySession(tokenFromRequest(c));
  if (!session) return c.json({ error: "Oturum gerekli" }, 401);
  return next();
});

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
      limit,
      allowedDistKods: scope.type === "merkez" ? null : scope.distKods,
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
      allowedDistKods: scope.type === "merkez" ? null : scope.distKods,
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
    const cities = await listMapCityYoY(region, scope.type === "merkez" ? null : scope.distKods);
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
  try {
    await scopeFromRequest(c);
  } catch (err) {
    if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
    return c.json({ error: (err as Error).message }, 500);
  }
  try {
    const status = await syncMapData(REPO_ROOT);
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
    const allowedDistKods = scope.type === "merkez" ? null : scope.distKods;
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
    const allowedDistKods = scope.type === "merkez" ? null : scope.distKods;
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
    const otvNet = c.req.query("otv") === "1";
    // unit=9le → tüm value alanları 9-Liter-Equivalent volume bazında döner;
    // boş veya başka değer → TL (default).
    const unit = c.req.query("unit") === "9le" ? "9le" as const : "tl" as const;
    const snap = await getKomutaSnapshot({
      forceRefresh,
      reelTL,
      otvNet,
      unit,
      allowedDistKods: scope.type === "merkez" ? null : scope.distKods,
      distId: scopeSingleDistId(scope),
    });
    return c.json(snap);
  } catch (err) {
    console.error("[/api/komuta] failed:", err);
    return c.json({ error: (err as Error).message }, 500);
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
    const snap = await getWietnauerYonetimSnapshot({
      forceRefresh,
      strategicBrands: tenant.strategicBrands ?? [],
      allowedDistKods: scope.type === "merkez" ? null : scope.distKods,
      distId: scopeSingleDistId(scope),
    });
    return c.json(snap);
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
};
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
      const snap = await fn({
        forceRefresh,
        strategicBrands: tenant.strategicBrands ?? [],
        allowedDistKods: scope.type === "merkez" ? null : scope.distKods,
        distId: scopeSingleDistId(scope),
      });
      return c.json(snap);
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
    const snap = await getWietnauerStokSnapshot({
      forceRefresh,
      strategicBrands: tenant.strategicBrands ?? [],
      // merkez tam görünürlük → allowedDistKods null; dist → izinli liste.
      allowedDistKods: scope.type === "merkez" ? null : scope.distKods,
      // merkez drill-down / dist tek-dist seçimi → scope'tan tek dist.
      distId: scopeSingleDistId(scope),
    });
    return c.json(snap);
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
      allowedDistKods: scope.type === "merkez" ? null : scope.distKods,
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

async function refreshAllSnapshots(reason: string) {
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

    // 1) Komuta (TL + 9L)
    for (const unit of ["tl", "9le"] as const) {
      await warmStep(tag, `komuta ${unit}`, () =>
        getKomutaSnapshot({ forceRefresh: true, unit }),
      );
    }

    // 2) V3 snapshot'ları — merkez kapsam. Bunlar daha önce gece job'ında
    //    tazelenMİYORdu; "son güncelleme" bu yüzden ilk hesap tarihinde donuyordu.
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
    for (const [name, fn] of v3) {
      await warmStep(tag, `v3 ${name}`, () => fn(merkezOpts));
    }

    // 3) Harita müşteri aynası — "Verileri yenile" butonuyla aynı sync.
    await warmStep(tag, "map sync", () => syncMapData(REPO_ROOT));

    console.log(`${tag} başarılı (${new Date().toISOString()})`);
  } catch (err) {
    console.error(`${tag} beklenmeyen hata:`, err);
  }
}

async function nightRefresh() {
  await refreshAllSnapshots("night");
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
  setTimeout(() => {
    void refreshAllSnapshots("startup");
  }, 10_000);
}

process.on("SIGINT", async () => {
  await closePool().catch(() => {});
  process.exit(0);
});
