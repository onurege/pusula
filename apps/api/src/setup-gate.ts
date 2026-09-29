/**
 * `/api/setup/*` için AYRI, dar kapı — Faz 0 Bootstrap sözleşmesi. Session
 * GEREKTİRMEZ (henüz kullanıcı yok — tavuk-yumurta); `SETUP_TOKEN` header'ı
 * gerektirir. `admin-gate.ts` ile AYNI ayrım nedeniyle (Metz — test
 * edilebilirlik, `server.ts` import'u ağır/yan-etkili) ayrı dosya: saf,
 * SIFIR yan-etkili bir middleware fabrikası (bkz. `__tests__/setup-gate.test.ts`).
 *
 * KAYIT SIRASI KRİTİK (server.ts): bu middleware VE üç setup route'u, global
 * session guard'ından (`app.use("/api/*", ...)`) ÖNCE kayıtlı olmalı — Hono
 * eşleşen middleware/route'ları KAYIT SIRASINA göre zincirler; setup
 * route'ları (terminal handler'lar) önce kayıtlı olduğu için session guard'a
 * hiç uğramaz. `PUBLIC_ROUTES`'a EKLENMEZ (Faz 0 H-1): o mekanizma yalnız
 * session-kontrolünü atlar, TEK BAŞINA hiçbir gerçek yetki sağlamaz — iki
 * mekanizma karışırsa (PUBLIC_ROUTES + bu middleware'in kayıt sırası
 * bozulursa) token'sız bir dünyaya açılabilir. Burada TEK gerçek kapı bu
 * middleware'dir.
 */
import type { MiddlewareHandler } from "hono";
import { isSetupModeActive, verifySetupToken, SETUP_TOKEN_HEADER } from "@enroute/core";

/**
 * Setup modu şu an aktif DEĞİLSE (SETUP_TOKEN yok/kısa VEYA aktif tenant
 * zaten tamamlanmış) — uç YOKMUŞ gibi 404 döner (401/403 DEĞİL): tamamlanmış
 * bir tenant'ta bu path'lerin VARLIĞINI bile ifşa etmemek için (H-1
 * durum-türevli kapanış — `isSetupModeActive()` HER İSTEKTE canlı kontrol
 * eder, in-memory bayrak yok).
 *
 * Aktifse ama token eksik/yanlışsa 401 (varlık zaten ima edilmiş durumda —
 * bir istemcinin token'sız denemesi setup'ın var olduğunu öğrenir, ama bu
 * yalnızca tenant GERÇEKTEN tamamlanmamışken mümkündür, ki o durumda zaten
 * hiçbir hassas veri yoktur).
 */
export function createSetupGate(): MiddlewareHandler {
  return async (c, next) => {
    if (!isSetupModeActive()) return c.json({ error: "Bulunamadı" }, 404);
    const token = c.req.header(SETUP_TOKEN_HEADER);
    if (!verifySetupToken(token)) return c.json({ error: "Kurulum token geçersiz" }, 401);
    return next();
  };
}
