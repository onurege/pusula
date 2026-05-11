type Row = Record<string, unknown>;

const TR_LOCALE = "tr-TR";

/**
 * Human-readable column header.
 * - "fatura_sayisi" → "Fatura Sayısı"
 * - "ad" → "Ad"
 * - "TXTAD" → "Txtad" (kept as-is if it doesn't look snake-case)
 *
 * Hand-tuned overrides for terms we know.
 */
const HEADER_OVERRIDES: Record<string, string> = {
  ad: "Ad",
  ciro: "Ciro",
  tahsilat: "Tahsilat",
  fatura: "Fatura",
  fatura_sayisi: "Fatura Sayısı",
  fatura_tutari: "Fatura Tutarı",
  tahsilat_tutari: "Tahsilat Tutarı",
  tahsilat_yuzdesi: "Tahsilat %",
  acik_bakiye: "Açık Bakiye",
  temsilci: "Temsilci",
  distributor: "Distribütör",
  guncel: "Güncel",
  beklenen: "Beklenen",
  degisim_pct: "Değişim %",
  guncel_oran: "Güncel Oran %",
  beklenen_oran: "Beklenen Oran %",
  acik: "Açık Bakiye",
  gun: "Gün",
  miktar: "Miktar",
  toplam_ciro: "Toplam Ciro",
  aktif_distributor: "Aktif Distribütör",
  aktif_temsilci: "Aktif Temsilci",
  toplam_fatura: "Toplam Fatura",
  toplam_tahsilat: "Toplam Tahsilat",
  tahsilat_orani: "Tahsilat Oranı",
};

function humanizeHeader(col: string): string {
  const key = col.toLowerCase();
  if (HEADER_OVERRIDES[key]) return HEADER_OVERRIDES[key];
  return col
    .replace(/_/g, " ")
    .split(" ")
    .map((w) => (w ? w[0]!.toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr") : ""))
    .join(" ");
}

/**
 * Detect if a column likely holds a monetary value, based on its name.
 * Adds ₺ suffix and rounds to integer for these.
 */
function isCurrencyColumn(col: string): boolean {
  const c = col.toLowerCase();
  return (
    c.includes("ciro") ||
    c.includes("tahsilat") ||
    c.includes("tutar") ||
    c.includes("bakiye") ||
    c.includes("guncel") ||
    c.includes("beklenen") ||
    c === "acik"
  );
}

function isPercentColumn(col: string): boolean {
  const c = col.toLowerCase();
  return c.includes("yuzde") || c.includes("oran") || c.endsWith("_pct") || c.includes("pct");
}

function isCountColumn(col: string): boolean {
  const c = col.toLowerCase();
  return c.includes("sayi") || c.includes("count") || c === "adet" || c === "miktar";
}

function isNumeric(v: unknown): boolean {
  return typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)));
}

function formatValue(v: unknown, col: string): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return new Date(v).toLocaleString(TR_LOCALE);

  if (typeof v === "number" || (typeof v === "string" && isNumeric(v))) {
    const n = typeof v === "number" ? v : Number(v);

    if (isCurrencyColumn(col)) {
      return Math.round(n).toLocaleString(TR_LOCALE) + " ₺";
    }
    if (isPercentColumn(col)) {
      return n.toLocaleString(TR_LOCALE, { maximumFractionDigits: 1 }) + "%";
    }
    if (isCountColumn(col) || Number.isInteger(n)) {
      return Math.round(n).toLocaleString(TR_LOCALE);
    }
    return n.toLocaleString(TR_LOCALE, { maximumFractionDigits: 2 });
  }

  return String(v);
}

function isNumericColumn(rows: Row[], col: string): boolean {
  // A column is treated as numeric if at least 70% of non-null values parse as numbers.
  let total = 0;
  let numeric = 0;
  for (const r of rows.slice(0, 50)) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    total++;
    if (isNumeric(v)) numeric++;
  }
  return total === 0 ? false : numeric / total >= 0.7;
}

export function ResultTable({ rows, max = 100 }: { rows: Row[]; max?: number }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
        Sonuç boş.
      </div>
    );
  }
  const cols = Object.keys(rows[0]!);
  const display = rows.slice(0, max);
  const numericFlags: Record<string, boolean> = {};
  for (const c of cols) numericFlags[c] = isNumericColumn(rows, c);

  return (
    <div className="overflow-auto rounded-lg border border-border bg-surface shadow-xs">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-2 border-b border-border">
            {cols.map((c) => (
              <th
                key={c}
                className={
                  "font-semibold text-[10px] uppercase tracking-wider text-muted px-4 py-2.5 whitespace-nowrap " +
                  (numericFlags[c] ? "text-right" : "text-left")
                }
              >
                {humanizeHeader(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {display.map((r, i) => (
            <tr
              key={i}
              className="border-b border-border/40 last:border-0 hover:bg-[var(--color-accent-soft)] transition-colors"
            >
              {cols.map((c) => {
                const v = r[c];
                const numeric = numericFlags[c];
                return (
                  <td
                    key={c}
                    className={
                      "px-4 py-2.5 align-top text-[13px] " +
                      (numeric ? "text-right tabular-nums font-medium" : "text-fg-2")
                    }
                  >
                    {formatValue(v, c)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && (
        <div className="px-4 py-2 text-[11px] text-muted bg-surface-2/40 border-t border-border">
          İlk {max} / toplam {rows.length.toLocaleString("tr-TR")} satır gösteriliyor
        </div>
      )}
    </div>
  );
}
