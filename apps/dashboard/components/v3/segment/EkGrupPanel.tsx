import { formatCompact } from "@/components/komuta/format";

/**
 * Müşteri Ek Grubu (bayilik formatı) segment paneli.
 *
 * Aktif müşteri oranı = son 30g'de en az 1 fatura kesmiş / o grupta toplam
 * tanımlı müşteri. Düşük oran = inaktif portföy uyarısı (sağdaki rozet renkli).
 */
export type EkGrupSegmentRow = {
  kod: string;
  ad: string;
  musteriSayi: number;
  aktifMusteriSayi: number;
  aktifMusteriOraniPct: number;
  ciro: number;
  payPct: number;
};

export function EkGrupPanel({ rows }: { rows: EkGrupSegmentRow[] }) {
  const visible = rows.slice(0, 12);
  const maxCiro = Math.max(1, ...visible.map((r) => r.ciro));

  return (
    <div className="v3-panel seg-panel">
      <div className="seg-head">
        <div className="seg-title">Müşteri Ek Grubu</div>
        <div className="seg-sub">
          Bayilik formatı · {rows.length} grup
          {rows.length > 12 ? ` · top ${visible.length} gösterimde` : ""}
        </div>
      </div>

      <div className="seg-list">
        {visible.length === 0 && (
          <div className="seg-empty">Henüz tanımlı ek grup yok</div>
        )}
        {visible.map((r) => {
          const aktifTone =
            r.aktifMusteriOraniPct >= 50
              ? "good"
              : r.aktifMusteriOraniPct >= 20
              ? "neutral"
              : "warn";
          return (
            <div key={r.kod} className="seg-row">
              <div className="seg-row-label" title={r.ad}>
                {r.ad}
              </div>
              <div className="seg-row-track">
                <div
                  className="seg-row-fill"
                  style={{ width: `${(r.ciro / maxCiro) * 100}%` }}
                />
                <div className="seg-row-meta">
                  <span className="num">{r.musteriSayi.toLocaleString("tr-TR")}</span>
                  <span className="sep">·</span>
                  <span className="num">₺{formatCompact(r.ciro)}</span>
                  <span className="sep">·</span>
                  <span className="pay">%{r.payPct.toFixed(1)}</span>
                  <span className="sep">·</span>
                  <span className={`active-pill ${aktifTone}`}>
                    aktif %{r.aktifMusteriOraniPct.toFixed(0)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

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
        .seg-row-meta { position: relative; display: flex; align-items: center; gap: 6px; height: 100%; padding: 0 10px; font-size: 11.5px; color: var(--color-fg); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
        .seg-row-meta .sep { opacity: 0.35; }
        .seg-row-meta .pay { font-weight: 600; }
        .active-pill { padding: 1px 7px; border-radius: 9px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.01em; }
        .active-pill.good { background: rgba(22, 163, 74, 0.12); color: #16a34a; }
        .active-pill.neutral { background: var(--color-surface); color: var(--color-muted); border: 1px solid var(--color-border); }
        .active-pill.warn { background: rgba(220, 38, 38, 0.10); color: #dc2626; }
        .seg-empty { font-size: 12px; color: var(--color-muted); padding: 12px 0; text-align: center; }
      `,
        }}
      />
    </div>
  );
}
