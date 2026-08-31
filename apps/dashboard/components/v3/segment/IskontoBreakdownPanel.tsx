import { formatCompact } from "@/components/komuta/format";
import { panelTitle, panelHidden } from "@/lib/content";

/**
 * md35 — İskonto Kırılımı: Ek Grup ve nokta (müşteri) bazında harcanan
 * iskonto tutarı (TBLMSDFATURA.DBLISKONTOTUTARI toplamı, son 30g).
 *
 * Sol: Ek Grup bazında iskonto tutarı (yatay bar, top 12).
 * Sağ: Nokta (müşteri) bazında iskonto tutarı tablosu (Top 20, iskonto DESC).
 */
export type EkGrupIskontoRow = {
  kod: string;
  ad: string;
  iskontoTutari: number;
  ciro: number;
  iskontoOraniPct: number;
  payPct: number;
};

export type MusteriIskontoRow = {
  musteriKod: number;
  unvan: string;
  ekGrupAd: string | null;
  iskontoTutari: number;
  ciro: number;
  iskontoOraniPct: number;
  payPct: number;
  rank: number;
};

export function IskontoBreakdownPanel({
  ekGrup,
  musteri,
}: {
  ekGrup: EkGrupIskontoRow[];
  musteri: MusteriIskontoRow[];
}) {
  if (panelHidden("panel.segment.iskonto")) return null;
  const ekGrupVisible = ekGrup.slice(0, 12);
  const maxIskonto = Math.max(1, ...ekGrupVisible.map((r) => r.iskontoTutari));

  return (
    <div className="v3-panel iskonto-break-panel">
      <div className="seg-head">
        <div className="seg-title">
          {panelTitle("panel.segment.iskonto", "İskonto Kırılımı — Ek Grup / Nokta")}
        </div>
        <div className="seg-sub">
          Son 30g DBLISKONTOTUTARI toplamı · Ek Grup ({ekGrup.length}) ve nokta (müşteri, top{" "}
          {musteri.length}) bazında
        </div>
      </div>

      <div className="iskonto-break-grid">
        <div className="iskonto-break-col">
          <div className="iskonto-break-col-title">Ek Grup bazında</div>
          {ekGrupVisible.length === 0 && <div className="seg-empty">Henüz veri yok</div>}
          <div className="seg-list">
            {ekGrupVisible.map((r) => (
              <div key={r.kod} className="seg-row">
                <div className="seg-row-label" title={r.ad}>
                  {r.ad}
                </div>
                <div className="seg-row-track">
                  <div
                    className="seg-row-fill iskonto-fill"
                    style={{ width: `${(r.iskontoTutari / maxIskonto) * 100}%` }}
                  />
                  <div className="seg-row-meta">
                    <span className="num">₺{formatCompact(r.iskontoTutari)}</span>
                    <span className="sep">·</span>
                    <span className="pay">%{r.payPct.toFixed(1)}</span>
                    <span className="sep">·</span>
                    <span className="disc">isk. oranı %{r.iskontoOraniPct.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="iskonto-break-col">
          <div className="iskonto-break-col-title">Nokta (müşteri) bazında — Top {musteri.length}</div>
          {musteri.length === 0 ? (
            <div className="seg-empty">Henüz veri yok</div>
          ) : (
            <div className="iskonto-table-wrap">
              <table className="iskonto-table">
                <thead>
                  <tr>
                    <th className="rank">#</th>
                    <th>Müşteri</th>
                    <th>Ek Grup</th>
                    <th className="num-col">İskonto</th>
                    <th className="num-col">Oran</th>
                  </tr>
                </thead>
                <tbody>
                  {musteri.map((r) => (
                    <tr key={r.musteriKod}>
                      <td className="rank">{r.rank}</td>
                      <td className="unvan" title={r.unvan}>
                        {r.unvan || `Müşteri #${r.musteriKod}`}
                      </td>
                      <td className="ekgrup" title={r.ekGrupAd ?? undefined}>
                        {r.ekGrupAd ?? "(Tanımsız)"}
                      </td>
                      <td className="num-col">₺{formatCompact(r.iskontoTutari)}</td>
                      <td className="num-col">%{r.iskontoOraniPct.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .iskonto-break-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        .seg-head { display: flex; flex-direction: column; gap: 2px; }
        .seg-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .seg-sub { font-size: 11.5px; color: var(--color-muted); }

        .iskonto-break-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
        @media (min-width: 900px) {
          .iskonto-break-grid { grid-template-columns: 1fr 1.3fr; align-items: start; }
        }
        .iskonto-break-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
        .iskonto-break-col-title { font-size: 11px; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.4px; }

        .seg-list { display: flex; flex-direction: column; gap: 10px; }
        .seg-row { display: grid; grid-template-columns: 120px 1fr; gap: 12px; align-items: center; }
        .seg-row-label { font-size: 12.5px; font-weight: 500; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .seg-row-track { position: relative; height: 30px; background: var(--color-surface-2); border-radius: 5px; overflow: hidden; }
        .seg-row-fill { position: absolute; inset: 0 auto 0 0; background: var(--color-accent-soft, rgba(59, 130, 246, 0.18)); border-radius: 5px; transition: width 0.3s ease-out; }
        .seg-row-fill.iskonto-fill { background: rgba(220, 38, 38, 0.14); }
        .seg-row-meta { position: relative; display: flex; align-items: center; gap: 6px; height: 100%; padding: 0 10px; font-size: 11.5px; color: var(--color-fg); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
        .seg-row-meta .sep { opacity: 0.35; }
        .seg-row-meta .pay { font-weight: 600; }
        .seg-row-meta .disc { color: var(--color-muted); }
        .seg-empty { font-size: 12px; color: var(--color-muted); padding: 12px 0; text-align: center; }

        .iskonto-table-wrap { overflow-x: auto; }
        .iskonto-table { width: 100%; border-collapse: collapse; font-size: 11.5px; font-variant-numeric: tabular-nums; }
        .iskonto-table th { text-align: left; padding: 6px 8px; font-size: 10px; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.3px; font-weight: 600; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
        .iskonto-table td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); color: var(--color-fg); }
        .iskonto-table tbody tr:last-child td { border-bottom: none; }
        .iskonto-table th.rank, .iskonto-table td.rank { width: 24px; color: var(--color-muted); }
        .iskonto-table th.num-col, .iskonto-table td.num-col { text-align: right; white-space: nowrap; }
        .iskonto-table td.unvan { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
        .iskonto-table td.ekgrup { max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-muted); }
      `,
        }}
      />
    </div>
  );
}
