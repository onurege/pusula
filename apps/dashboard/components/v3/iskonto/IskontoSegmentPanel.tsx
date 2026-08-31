import { formatCompact } from "@/components/komuta/format";

type SegmentRow = {
  segment: string;
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  musteriSayi: number;
  faturaSayisi: number;
};

/**
 * Panel E — Segment Kırılımı (Müşteri Tipi × İskonto Oranı).
 *
 * TBLMUSTERIEKSAHA LNGEKSAHAKODU=8 lookup ile müşteri tipleri (Perakende,
 * On Trade, Otel, Tali Bayi, OPA...). Her segment için: brüt, iskonto, net,
 * ortalama oran, müşteri/fatura sayısı.
 *
 * Yatay bar — bar uzunluğu iskonto oranı %, renk tier.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function IskontoSegmentPanel({ segments }: { segments: SegmentRow[] }) {
  if (panelHidden("panel.iskonto.segment")) return null;
  // Bar referansı: maksimum oran (en az 25%) — görsel kıyas için
  const maxOran = Math.max(25, ...segments.map((s) => s.iskontoOraniPct));

  return (
    <div className="seg-panel">
      <div className="seg-head">
        <div>
          <div className="seg-title">{panelTitle("panel.iskonto.segment", "Segment Kırılımı")}</div>
          <div className="seg-sub">
            Son 30g · Müşteri tipi × ortalama iskonto oranı (TBLMUSTERIEKSAHA
            saha 8)
          </div>
        </div>
      </div>

      <div className="seg-rows">
        {segments.map((s) => {
          const color =
            s.iskontoOraniPct < 15
              ? "#16a34a"
              : s.iskontoOraniPct < 25
              ? "#d97706"
              : "#dc2626";
          const widthPct = (s.iskontoOraniPct / maxOran) * 100;
          return (
            <div key={s.segment} className="seg-row">
              <div className="seg-label" title={s.segment}>
                <span className="seg-name">{s.segment}</span>
                <span className="seg-meta">
                  {s.musteriSayi.toLocaleString("tr-TR")} müşteri ·{" "}
                  {s.faturaSayisi.toLocaleString("tr-TR")} fatura
                </span>
              </div>
              <div className="seg-bar-wrap">
                <div className="seg-bar-track">
                  <div
                    className="seg-bar-fill"
                    style={{ width: `${Math.max(2, widthPct)}%`, background: color }}
                  />
                </div>
                <div className="seg-bar-val" style={{ color }}>
                  %{s.iskontoOraniPct.toFixed(1)}
                </div>
              </div>
              <div className="seg-money">
                <div className="seg-money-row">
                  <span className="m-label">Brüt</span>
                  <span className="m-val">₺{formatCompact(s.brut)}</span>
                </div>
                <div className="seg-money-row">
                  <span className="m-label">İskonto</span>
                  <span className="m-val muted">₺{formatCompact(s.iskonto)}</span>
                </div>
                <div className="seg-money-row">
                  <span className="m-label">Net</span>
                  <span className="m-val strong">₺{formatCompact(s.net)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .seg-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .seg-head { margin-bottom: 12px; }
        .seg-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .seg-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .seg-rows { display: flex; flex-direction: column; gap: 4px; }
        .seg-row {
          display: grid;
          grid-template-columns: 200px 1fr 260px;
          align-items: center;
          gap: 16px;
          padding: 10px 8px;
          border-bottom: 1px solid var(--color-border);
          font-size: 12.5px;
        }
        .seg-row:last-child { border-bottom: none; }
        .seg-row:hover { background: var(--color-surface-2); border-radius: 6px; }
        .seg-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .seg-name { font-weight: 600; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .seg-meta { font-size: 11px; color: var(--color-muted-2); }
        .seg-bar-wrap { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .seg-bar-track { flex: 1; height: 10px; background: var(--color-surface-2); border-radius: 5px; overflow: hidden; }
        .seg-bar-fill { height: 100%; border-radius: 5px; opacity: 0.85; transition: width 0.3s ease-out; }
        .seg-bar-val { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 52px; text-align: right; font-size: 13px; }
        .seg-money { display: flex; gap: 14px; justify-content: flex-end; }
        .seg-money-row { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 72px; }
        .m-label { font-size: 10px; color: var(--color-muted-2); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
        .m-val { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--color-fg); font-weight: 500; }
        .m-val.muted { color: var(--color-muted); }
        .m-val.strong { color: var(--color-fg); font-weight: 600; }
        @media (max-width: 760px) {
          .seg-row { grid-template-columns: 1fr; gap: 10px; }
          .seg-money { justify-content: flex-start; }
        }
      `,
        }}
      />
    </div>
  );
}
