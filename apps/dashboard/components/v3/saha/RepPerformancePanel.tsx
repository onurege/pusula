import { formatCompact } from "@/components/komuta/format";

export type RepRow = {
  repId: number;
  ad: string;
  distributor: string | null;
  ziyaret: number;
  uniqueMusteri: number;
  /** md41: son 30g fatura kesilen distinct müşteri */
  aktifMusteri: number;
  siparisliZiyaret: number;
  donusumPct: number;
  rutDisiPct: number;
  rank: number;
};

/**
 * Temsilci performans paneli — son 30g Top 20.
 * Sıralama: toplam ziyaret DESC. Yan-metrikler: dönüşüm %, rut dışı %.
 */
import { panelTitle, panelHidden } from "@/lib/content";
import { t, type Locale } from "@/lib/i18n";

export function RepPerformancePanel({ rows, locale = "tr" }: { rows: RepRow[]; locale?: Locale }) {
  if (panelHidden("panel.saha.rep")) return null;
  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.saha.rep", t(locale, "panel.saha.rep", "Temsilci Performansı"))}</div>
          <div className="v3-panel-sub">
            {locale === "en"
              ? `Last 30d · Top ${rows.length} reps · visits + conversion + out-of-route share`
              : `Son 30g · Top ${rows.length} temsilci · ziyaret + dönüşüm + rut dışı payı`}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">{locale === "en" ? "No visit records in this window." : "Bu pencerede ziyaret kaydı yok."}</div>
      ) : (
        <div className="v3-table-wrap">
          <table className="v3-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>{t(locale, "col.temsilci", "Temsilci")}</th>
                <th>{t(locale, "col.distributor", "Distribütör")}</th>
                <th className="num">{t(locale, "col.ziyaret", "Ziyaret")}</th>
                <th className="num">{locale === "en" ? "Active Customers" : "Aktif Müşteri"}</th>
                <th className="num">{locale === "en" ? "Orders" : "Sipariş"}</th>
                <th className="num">{locale === "en" ? "Conversion" : "Dönüşüm"}</th>
                <th className="num">{locale === "en" ? "Out-of-Route" : "Rut Dışı"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.repId}>
                  <td className="rank">{r.rank}</td>
                  <td className="unvan" title={r.ad}>
                    {r.ad.length > 40 ? r.ad.slice(0, 37) + "…" : r.ad}
                  </td>
                  <td>{r.distributor || "—"}</td>
                  <td className="num">{formatCompact(r.ziyaret)}</td>
                  <td
                    className="num"
                    title={locale === "en" ? "Distinct customers invoiced in the last 30d" : "Son 30g fatura kesilen distinct müşteri"}
                  >
                    {r.aktifMusteri.toLocaleString("tr-TR")}
                  </td>
                  <td className="num">{r.siparisliZiyaret.toLocaleString("tr-TR")}</td>
                  <td className="num" style={{ color: r.donusumPct >= 70 ? "var(--color-good, #16a34a)" : r.donusumPct >= 40 ? "var(--color-fg)" : "var(--color-bad, #dc2626)" }}>
                    %{r.donusumPct.toFixed(0)}
                  </td>
                  <td className="num" style={{ color: r.rutDisiPct > 30 ? "var(--color-warn, #d97706)" : "var(--color-muted-2)" }}>
                    %{r.rutDisiPct.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .empty { padding: 24px; color: var(--color-muted); font-size: 13px; text-align: center; }
      `,
        }}
      />
    </div>
  );
}
