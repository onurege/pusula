/**
 * Demo köprüsü — YALNIZCA demoData tenant (fmcg-demo) için.
 *
 * Neden gerek: harita müşterileri SENTETİK (`fmcg-demo.sqlite` `map_customers`,
 * id 1000000–1001999) ve gerçek PERNOD_TEST'te KARŞILIĞI YOK. Reorder motoru
 * ise canlı DB'yi GERÇEK `LNGKOD` ile sorgular → sentetik harita id'si hiçbir
 * faturayla eşleşmez → panel boş. Bu köprü, sentetik harita id'sini
 * DETERMİNİSTİK olarak gerçek, aktif bir müşteriye eşler; böylece demo
 * panelinde dolu (İLLÜSTRATİF — "bu müşterinin gerçek verisi" değil) reorder
 * gösterilir.
 *
 * Prod/gerçek tenant'ta KULLANILMAZ — `server.ts` bu sarmalamayı yalnızca
 * `getTenantConfig().demoData` iken uygular; gerçek tenant reorder'ı olduğu
 * gibi çalışır. Salt-okunur (yalnız SELECT).
 */
import { runReadOnly } from "./db.js";
import { sqlNow } from "./now.js";

// Modül-ömrü cache — havuz bir kez çözülür (tek-sefer ~10sn DB taraması demo
// açılışında; sonraki tüm demo tıklamaları anında eşlenir). Reorder'ın
// "per-müşteri cache YOK" felsefesini ihlal etmez: bu havuz müşteri-bağımsız.
let poolCache: number[] | null = null;

async function loadRealCustomerPool(): Promise<number[]> {
  if (poolCache) return poolCache;
  // Aktif + ek-gruplu + son 365g'de faturası olan GERÇEK müşteriler — reorder
  // sinyallerinin (walletGap/peerCross + overdue) dolu gelme olasılığı yüksek.
  // EXISTS (semi-join) → DISTINCT+JOIN'den hafif. LNGKOD DESC = daha yeni/küçük
  // hesaplar (ağır mega-hesaplardan kaçın → panel daha hızlı dolar).
  const sql = `
    SELECT TOP 800 m.LNGKOD
    FROM dbo.TBLMUSTERI m
    WHERE m.BYTDURUM = 0 AND LTRIM(RTRIM(m.TXTEKGRUPKOD)) <> ''
      AND EXISTS (
        SELECT 1 FROM dbo.TBLMSDFATURA f
        WHERE f.LNGMUSTERIKOD = m.LNGKOD AND f.BYTTUR = 0 AND f.BYTDURUM = 0
          AND f.TRHISLEMTARIHI >= DATEADD(day, -365, ${sqlNow()})
      )
    ORDER BY m.LNGKOD DESC`;
  const r = await runReadOnly(sql, { limit: 800, timeoutMs: 60_000 });
  poolCache = r.rows.map((x) => Number((x as { LNGKOD: unknown }).LNGKOD)).filter(Number.isInteger);
  return poolCache;
}

// Deterministik 32-bit karıştırma (bağımlılıksız) — aynı sentetik id HER ZAMAN
// aynı gerçek müşteriye eşlenir (demo tutarlılığı).
function hash32(n: number): number {
  let h = (n >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Sentetik harita müşteri id'sini deterministik gerçek `LNGKOD`'a eşler.
 * Havuz boşsa (DB erişilemez vb.) orijinal id'yi döner (no-op → panel boş,
 * patlamaz).
 */
export async function resolveDemoReorderCustomer(syntheticId: number): Promise<number> {
  const pool = await loadRealCustomerPool();
  if (pool.length === 0) return syntheticId;
  return pool[hash32(syntheticId) % pool.length]!;
}
