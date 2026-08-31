#!/usr/bin/env node
/**
 * TÜFE endeksini GERÇEK verilerle günceller → data/inflation/tufe-tr.json.
 *
 * Kaynak: Web TÜFE public API (https://www.apiwebtufe.com/api/v1) — KEY GEREKMEZ.
 *   - Varsayılan (resmi):  /tufe/tuik-comparison → "TÜİK" alanı = resmi TÜİK
 *     endeksi (2025=100). Ay sonu yayınlanmamışsa null (Reel TL clamp devreye girer).
 *   - Alternatif (bağımsız, güncel): TUFE_SOURCE=webtufe → /tufe/endeks (Web TÜFE
 *     kendi günlük endeksi, yayın gecikmesi YOK).
 *
 * Reel TL (Cockpit) bu endeksin ORANINI kullanır (currentIndex/pastIndex) —
 * baz yılı (2025=100) önemsiz, oran sabit kalır.
 *
 * NOT: EVDS (evds2/evds3) REST API'si 2026'da SPA portalına taşındı ve public
 * REST endpoint'i JSON döndürmüyor; bu yüzden Web TÜFE public API'sine geçildi.
 *
 * Kullanım:
 *   node scripts/update-tufe.mjs               # resmi TÜİK serisi (varsayılan)
 *   TUFE_SOURCE=webtufe node scripts/update-tufe.mjs   # Web TÜFE bağımsız endeks
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(REPO_ROOT, "data/inflation/tufe-tr.json");

const API = (process.env.TUFE_API_BASE || "https://www.apiwebtufe.com/api/v1").replace(/\/+$/, "");
const SOURCE = (process.env.TUFE_SOURCE || "tuik").toLowerCase(); // "tuik" | "webtufe"

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const ct = res.headers.get("content-type") || "";
  const body = await res.text();
  if (!res.ok || !/json/i.test(ct) || body.trimStart().startsWith("<")) {
    throw new Error(`${url} → ${res.status} (${ct}) ${body.slice(0, 120).replace(/\s+/g, " ")}`);
  }
  return JSON.parse(body);
}

/** Günlük [{date, value}] → aylık {YYYY-MM: value} (ay içindeki EN SON tarihi al). */
function toMonthly(rows, pick) {
  const byMonth = new Map(); // YYYY-MM -> { date, value }
  for (const r of rows) {
    const date = String(r.date ?? "").slice(0, 10);
    const m = date.match(/^(\d{4})-(\d{2})-\d{2}$/);
    const value = pick(r);
    if (!m || value == null || !Number.isFinite(Number(value))) continue;
    const key = `${m[1]}-${m[2]}`;
    const prev = byMonth.get(key);
    if (!prev || date > prev.date) byMonth.set(key, { date, value: Number(value) });
  }
  const out = {};
  for (const [k, v] of byMonth) out[k] = v.value;
  return out;
}

async function main() {
  let monthlyIndex;
  let sourceLabel;
  let baseNote;

  if (SOURCE === "webtufe") {
    const rows = await getJson(`${API}/tufe/endeks`);
    monthlyIndex = toMonthly(rows, (r) => r.value);
    sourceLabel = "Web TÜFE bağımsız endeks (apiwebtufe.com /tufe/endeks, 2025=100)";
    baseNote = "Web TÜFE (bağımsız, günlük ölçüm). Resmi TÜİK değildir.";
  } else {
    const rows = await getJson(`${API}/tufe/tuik-comparison`);
    monthlyIndex = toMonthly(rows, (r) => r["TÜİK"]); // yayınlanmamış ay = null → atlanır
    sourceLabel = "Resmi TÜİK endeksi (apiwebtufe.com /tufe/tuik-comparison, 2025=100)";
    baseNote = "Resmi TÜİK TÜFE endeksi (Web TÜFE API üzerinden). Yayınlanmamış ay atlanır → Reel TL clamp devrede.";
  }

  const keys = Object.keys(monthlyIndex).sort();
  if (keys.length === 0) throw new Error("Ayrıştırılabilir endeks satırı yok.");

  const out = {
    $schema:
      "Türkiye TÜFE aylık endeks. Reel TL = pastValue × (currentIndex / pastIndex) — baz yılı ORAN için önemsiz.",
    source: `${sourceLabel} — scripts/update-tufe.mjs ile otomatik. ${baseNote}`,
    lastUpdated: new Date().toISOString(),
    coverage: `${keys[0]} … ${keys[keys.length - 1]}`,
    monthlyIndex,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(
    `[update-tufe] ✓ ${keys.length} ay (${keys[0]} … ${keys[keys.length - 1]}) · kaynak=${SOURCE} → ${path.relative(REPO_ROOT, OUT_PATH)}`,
  );
}

main().catch((e) => {
  console.error("[update-tufe] hata:", e?.message ?? e);
  process.exit(1);
});
