import { formatCompact } from "@/components/komuta/format";

/**
 * Cirosal Segment paneli — TBLCIROSALSEGMENTMUSTERI.TXTSEGMENT bazlı.
 *
 * Wietnauer'da bu boyut sıklıkla boş (program tanımlanmamış); o durumda
 * rows = [] gelir ve empty-state render edilir.
 */
export type CirosalSegmentRow = {
  segment: string;
  musteriSayi: number;
  ciro: number;
  payPct: number;
};

export function CirosalSegmentPanel({ rows }: { rows: CirosalSegmentRow[] }) {
  const isEmpty = rows.length === 0;
  const maxCiro = Math.max(1, ...rows.map((r) => r.ciro));

  return (
    <div className="v3-panel seg-panel">
      <div className="seg-head">
        <div className="seg-title">Cirosal Segment</div>
        <div className="seg-sub">
          {isEmpty
            ? "Tüketici ciro bazlı tanım yok"
            : `Ciro bazlı tüketici segmenti · ${rows.length} segment`}
        </div>
      </div>

      {isEmpty ? (
        <div className="seg-empty-state">
          <div className="empty-icon">∅</div>
          <div className="empty-title">Henüz tanımlı segment yok</div>
          <div className="empty-desc">
            TBLCIROSALSEGMENTMUSTERI tablosunda etiketli müşteri bulunamadı.
            Cirosal segment programı kurulduğunda bu panel otomatik dolar.
          </div>
        </div>
      ) : (
        <div className="seg-list">
          {rows.map((r) => (
            <div key={r.segment} className="seg-row">
              <div className="seg-row-label" title={r.segment}>
                {r.segment}
              </div>
              <div className="seg-row-track">
                <div
                  className="seg-row-fill"
                  style={{ width: `${(r.ciro / maxCiro) * 100}%` }}
                />
                <div className="seg-row-meta">
                  <span className="num">{r.musteriSayi.toLocaleString("tr-TR")} müşteri</span>
                  <span className="sep">·</span>
                  <span className="num">₺{formatCompact(r.ciro)}</span>
                  <span className="sep">·</span>
                  <span className="pay">%{r.payPct.toFixed(1)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .seg-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .seg-head { display: flex; flex-direction: column; gap: 2px; }
        .seg-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .seg-sub { font-size: 11.5px; color: var(--color-muted); }
        .seg-list { display: flex; flex-direction: column; gap: 10px; }
        .seg-row { display: grid; grid-template-columns: 130px 1fr; gap: 12px; align-items: center; }
        .seg-row-label { font-size: 12.5px; font-weight: 500; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .seg-row-track { position: relative; height: 30px; background: var(--color-surface-2); border-radius: 5px; overflow: hidden; }
        .seg-row-fill { position: absolute; inset: 0 auto 0 0; background: var(--color-accent-soft, rgba(59, 130, 246, 0.18)); border-radius: 5px; transition: width 0.3s ease-out; }
        .seg-row-meta { position: relative; display: flex; align-items: center; gap: 6px; height: 100%; padding: 0 10px; font-size: 11.5px; color: var(--color-fg); font-variant-numeric: tabular-nums; }
        .seg-row-meta .sep { opacity: 0.35; }
        .seg-row-meta .pay { font-weight: 600; }
        .seg-empty-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 24px 12px; text-align: center; }
        .empty-icon { font-size: 28px; color: var(--color-muted-2); opacity: 0.5; line-height: 1; margin-bottom: 4px; }
        .empty-title { font-size: 13px; font-weight: 600; color: var(--color-fg); }
        .empty-desc { font-size: 11.5px; color: var(--color-muted); max-width: 280px; line-height: 1.5; }
      `,
        }}
      />
    </div>
  );
}
