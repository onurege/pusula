import { formatCompact } from "@/components/komuta/format";

type BrandRow = {
  marka: string;
  markaKod: string;
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  yoyNetPct: number | null;
  rank: number;
  isStratejik: boolean;
};

/**
 * Panel C — Marka × İskonto Etkinliği (Top 15).
 *
 * Sıralama: brüt ciro DESC. Tablo: marka, brüt, iskonto, net, iskonto/ciro%,
 * yoY net büyüme%.
 *
 * Renk anlamı (iskonto/ciro %):
 *   <15%  → #16a34a sağlıklı
 *   15-25% → #d97706 nötr
 *   >25%  → #dc2626 yatırım uyarısı
 *
 * yoY rengi: >0 yeşil, <0 kırmızı, null gri.
 */
export function IskontoBrandPanel({ brands }: { brands: BrandRow[] }) {
  const stratList = brands.filter((b) => b.isStratejik);

  return (
    <div className="brand-panel">
      <div className="brand-head">
        <div>
          <div className="brand-title">Marka × İskonto Etkinliği</div>
          <div className="brand-sub">
            Son 30g · Top 15 marka · Detay seviyesi (brüt = birim × miktar)
            {stratList.length > 0 && (
              <>
                {" · "}
                <span className="strat-dot" /> {stratList.length} stratejik
              </>
            )}
          </div>
        </div>
      </div>

      <div className="brand-table-wrap">
        <table className="brand-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Marka</th>
              <th className="num">Brüt</th>
              <th className="num">İskonto</th>
              <th className="num">Net</th>
              <th className="num">Oran</th>
              <th className="num">YoY Net</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => {
              const oranColor =
                b.iskontoOraniPct < 15
                  ? "#16a34a"
                  : b.iskontoOraniPct < 25
                  ? "#d97706"
                  : "#dc2626";
              const yoyColor =
                b.yoyNetPct == null
                  ? "var(--color-muted-2)"
                  : b.yoyNetPct >= 0
                  ? "#16a34a"
                  : "#dc2626";
              return (
                <tr key={b.markaKod}>
                  <td className="rank">{b.rank}</td>
                  <td className="marka">
                    {b.isStratejik && <span className="strat-dot" />}
                    <span title={b.marka}>{b.marka}</span>
                  </td>
                  <td className="num">₺{formatCompact(b.brut)}</td>
                  <td className="num">₺{formatCompact(b.iskonto)}</td>
                  <td className="num">₺{formatCompact(b.net)}</td>
                  <td className="num oran" style={{ color: oranColor }}>
                    %{b.iskontoOraniPct.toFixed(1)}
                  </td>
                  <td className="num yoy" style={{ color: yoyColor }}>
                    {b.yoyNetPct == null
                      ? "—"
                      : `${b.yoyNetPct >= 0 ? "+" : ""}${b.yoyNetPct.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="brand-legend">
        <span style={{ color: "#16a34a" }}>● sağlıklı &lt;15%</span>
        <span className="sep">·</span>
        <span style={{ color: "#d97706" }}>● nötr 15–25%</span>
        <span className="sep">·</span>
        <span style={{ color: "#dc2626" }}>● uyarı &gt;25%</span>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .brand-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .brand-head { margin-bottom: 12px; }
        .brand-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .brand-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .strat-dot { display: inline-block; width: 8px; height: 8px; background: var(--color-accent); border-radius: 50%; margin-right: 6px; vertical-align: middle; }
        .brand-table-wrap { overflow-x: auto; margin: 0 -4px; }
        .brand-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 680px; }
        .brand-table thead th {
          text-align: left;
          padding: 8px 10px;
          font-size: 10.5px;
          font-weight: 600;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border-bottom: 1px solid var(--color-border);
        }
        .brand-table thead th.num { text-align: right; }
        .brand-table tbody tr { border-bottom: 1px solid var(--color-border); }
        .brand-table tbody tr:hover { background: var(--color-surface-2); }
        .brand-table td { padding: 9px 10px; color: var(--color-fg); }
        .brand-table td.rank { font-weight: 600; color: var(--color-muted); font-variant-numeric: tabular-nums; }
        .brand-table td.marka { font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .brand-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .brand-table td.oran, .brand-table td.yoy { font-weight: 600; }
        .brand-legend { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--color-border); font-size: 11px; color: var(--color-muted-2); display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .brand-legend .sep { opacity: 0.4; }
      `,
        }}
      />
    </div>
  );
}
