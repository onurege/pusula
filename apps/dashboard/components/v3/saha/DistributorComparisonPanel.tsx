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

export function DistributorComparisonPanel({ rows }: { rows: DistRow[] }) {
  if (panelHidden("panel.saha.distcompare")) return null;
  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.saha.distcompare", "Distribütör Karşılaştırma")}</div>
          <div className="v3-panel-sub">
            Son 30g · Top {rows.length} distribütör operasyonel performansı
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">Bu pencerede ziyaret kaydı yok.</div>
      ) : (
        <div className="v3-table-wrap">
          <table className="v3-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Distribütör</th>
                <th>Bölge</th>
                <th className="num">Aktif Tem.</th>
                <th className="num">Ziyaret</th>
                <th className="num">Kapsanan M.</th>
                <th className="num">Dönüşüm</th>
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
