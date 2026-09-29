import type { SatisRepRow } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";
import { DeltaBadge } from "./DeltaBadge";
import { t, type Locale } from "@/lib/i18n";

/**
 * Satış Temsilcisi Leaderboard — Top 20 temsilci son 30g ciro ile
 * sıralanmış. Distribütör + bölge etiketi temsilci satırının yanında.
 * Hedef gerçekleşmesi kapsam DIŞI (kullanıcı talebi) — saf performans.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function RepLeaderboardPanel({
  rows,
  rangeLabel = "Son 30g",
  unit = "tl",
  volumeShort,
  locale = "tr",
}: {
  rows: SatisRepRow[];
  /** md21 — seçili tarih aralığı etiketi (ör. "Son 30g" veya "12 Ağu – 19 Ağu"). */
  rangeLabel?: string;
  /**
   * md21 (faz A4 ek) — birim filtresi. `"tl"` (varsayılan) → mevcut ₺
   * davranışı aynen. Tenant hacim birimi anahtarı verilirse `ciro` yerine
   * `hacim` (70cl eşdeğeri, `ciro`'nun backend ikizi) gösterilir. Ort. Sepet
   * ve Δ için hacim ikizi backend'de yok — bu iki alan her zaman ₺ kalır.
   */
  unit?: string;
  /** Hacim birimi kısa etiketi (ör. "70cl") — yalnızca `unit !== "tl"` iken kullanılır. */
  volumeShort?: string;
  locale?: Locale;
}) {
  if (panelHidden("panel.satis.rep")) return null;
  const title = panelTitle("panel.satis.rep", t(locale, "panel.satis.rep", "Satış Temsilcisi Leaderboard"));
  const useVolume = unit !== "tl" && Boolean(volumeShort);
  if (rows.length === 0) {
    return (
      <div className="v3-panel v3-panel-empty">
        <div className="v3-panel-title">{title}</div>
        <p>
          {locale === "en"
            ? `No rep-assigned invoices found in ${rangeLabel}.`
            : `${rangeLabel} içinde temsilci atamalı fatura bulunamadı.`}
        </p>
      </div>
    );
  }

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{title}</div>
          <div className="v3-panel-sub">
            {locale === "en"
              ? `${rangeLabel} net ${useVolume ? `volume (${volumeShort})` : "revenue"} · Top ${rows.length} · delta vs. previous period`
              : `${rangeLabel} net ${useVolume ? `hacim (${volumeShort})` : "ciro"} · Top ${rows.length} · vs önceki dönem delta`}
          </div>
        </div>
      </div>

      <div className="v3-table-wrap">
        <table className="v3-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>{t(locale, "col.temsilci", "Temsilci")}</th>
              <th>{t(locale, "col.distributor", "Distribütör")}</th>
              <th>{t(locale, "col.bolge", "Bölge")}</th>
              <th className="num">
                {useVolume
                  ? `${t(locale, "col.hacim", "Hacim")} (${volumeShort})`
                  : t(locale, "col.ciro", "Ciro")}
              </th>
              <th className="num">{t(locale, "col.musteri", "Müşteri")}</th>
              <th className="num">{t(locale, "col.ort_sepet", "Ort. Sepet")}</th>
              <th className="num">{t(locale, "col.delta", "Δ")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="rank">{r.rank}</td>
                <td className="name" title={r.ad}>
                  {r.ad}
                </td>
                <td className="dist">{r.distAd || "—"}</td>
                <td className="region">{r.region || "—"}</td>
                <td className="num strong">
                  {useVolume ? `${formatCompact(r.hacim)} ${volumeShort}` : `₺${formatCompact(r.ciro)}`}
                </td>
                <td className="num">
                  {r.musteriSayi.toLocaleString("tr-TR")}
                </td>
                <td className="num">₺{formatCompact(r.ortSepet)}</td>
                <td className="num">
                  <DeltaBadge pct={r.deltaPct} hasPrev={r.prevCiro > 0} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-empty p { font-size: 12.5px; color: var(--color-muted); margin: 8px 0 0; }
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .v3-table-wrap { overflow-x: auto; margin: 0 -4px; }
        .v3-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 820px; }
        .v3-table thead th { text-align: left; padding: 8px 10px; font-size: 10.5px; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--color-border); }
        .v3-table thead th.num { text-align: right; }
        .v3-table tbody tr { border-bottom: 1px solid var(--color-border); }
        .v3-table tbody tr:hover { background: var(--color-surface-2); }
        .v3-table td { padding: 9px 10px; color: var(--color-fg); }
        .v3-table td.rank { font-weight: 600; color: var(--color-muted); font-variant-numeric: tabular-nums; }
        .v3-table td.name { font-weight: 500; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .v3-table td.dist { color: var(--color-muted); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .v3-table td.region { color: var(--color-muted-2); }
        .v3-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .v3-table td.num.strong { font-weight: 600; color: var(--color-fg); }
      `,
        }}
      />
    </div>
  );
}
