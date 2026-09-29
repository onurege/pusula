import { formatCompact } from "@/components/komuta/format";

export type DistRow = {
  distKod: number;
  distributor: string;
  bolge: string | null;
  aktifTemsilci: number;
  ziyaret: number;
  kapsananMusteri: number;
  donusumPct: number;
  rank: number;
};

/**
 * Distribütör karşılaştırma — Top 10 son 30g operasyonel performans.
 * Aktif temsilci × ziyaret × kapsama × dönüşüm matrisi.
 */
import { panelTitle, panelHidden } from "@/lib/content";
import { t, type Locale } from "@/lib/i18n";

export function DistributorComparisonPanel({ rows, locale = "tr" }: { rows: DistRow[]; locale?: Locale }) {
  if (panelHidden("panel.saha.distcompare")) return null;
  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.saha.distcompare", t(locale, "panel.saha.distcompare", "Distribütör Karşılaştırma"))}</div>
          <div className="v3-panel-sub">
            {locale === "en"
              ? `Last 30d · Top ${rows.length} distributors' operational performance`
              : `Son 30g · Top ${rows.length} distribütör operasyonel performansı`}
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
                <th>{t(locale, "col.distributor", "Distribütör")}</th>
                <th>{t(locale, "col.bolge", "Bölge")}</th>
                <th className="num">{locale === "en" ? "Active Reps" : "Aktif Tem."}</th>
                <th className="num">{t(locale, "col.ziyaret", "Ziyaret")}</th>
                <th className="num">{locale === "en" ? "Covered Cust." : "Kapsanan M."}</th>
                <th className="num">{locale === "en" ? "Conversion" : "Dönüşüm"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.distKod}>
                  <td className="rank">{r.rank}</td>
                  <td className="unvan" title={r.distributor}>
                    {r.distributor.length > 40
                      ? r.distributor.slice(0, 37) + "…"
                      : r.distributor}
                  </td>
                  <td>{r.bolge || "—"}</td>
                  <td className="num">{r.aktifTemsilci.toLocaleString("tr-TR")}</td>
                  <td className="num">{formatCompact(r.ziyaret)}</td>
                  <td className="num">{r.kapsananMusteri.toLocaleString("tr-TR")}</td>
                  <td
                    className="num"
                    style={{
                      color:
                        r.donusumPct >= 70
                          ? "var(--color-good, #16a34a)"
                          : r.donusumPct >= 40
                            ? "var(--color-fg)"
                            : "var(--color-bad, #dc2626)",
                    }}
                  >
                    %{r.donusumPct.toFixed(0)}
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
