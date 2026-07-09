import type { NewCustomerRow } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";

/**
 * Yeni Müşteri Kazanımı — son 90g'de İLK faturası kesilmiş müşteriler.
 *
 * Backend MIN(TRHISLEMTARIHI) per müşteri hesaplıyor; bu tarih son 90g
 * içindeyse "yeni müşteri" sayılıyor. Müşterinin "ait olduğu" distribütör
 * = ilk faturasını kesen distribütör.
 *
 * KPI: toplam yeni müşteri sayısı + bu müşterilerin son 90g toplam cirosu.
 * Liste: distribütör × yeni müşteri Top 15.
 */
export function NewCustomersPanel({
  items,
  totalYeniMusteri,
  totalYeniCiro,
}: {
  items: NewCustomerRow[];
  totalYeniMusteri: number;
  totalYeniCiro: number;
}) {
  const maxYeni = Math.max(1, ...items.map((i) => i.yeniMusteriSayi));

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Yeni Müşteri Kazanımı</div>
          <div className="v3-panel-sub">
            Son 90g · ilk faturası bu pencerede kesilmiş müşteriler
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-tile">
          <div className="kpi-label">Toplam Yeni Müşteri</div>
          <div className="kpi-val">
            {totalYeniMusteri.toLocaleString("tr-TR")}
          </div>
          <div className="kpi-sub">son 90g</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Yeni Müşteri Cirosu</div>
          <div className="kpi-val">₺{formatCompact(totalYeniCiro)}</div>
          <div className="kpi-sub">son 90g net</div>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="empty">Bu pencerede yeni müşteri kazanılmamış.</p>
      ) : (
        <div className="v3-bars">
          <div className="bars-head">
            <span>Distribütör × Yeni Müşteri (Top {items.length})</span>
          </div>
          {items.map((r) => (
            <div key={r.distId} className="bar-row">
              <div className="bar-label" title={r.distAd}>
                <span className="bar-name">{r.distAd}</span>
                {r.region && <span className="bar-region">{r.region}</span>}
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${(r.yeniMusteriSayi / maxYeni) * 100}%` }}
                />
              </div>
              <div className="bar-meta">
                <span className="bar-val">
                  {r.yeniMusteriSayi.toLocaleString("tr-TR")}
                </span>
                <span className="bar-ciro">
                  ₺{formatCompact(r.yeniMusteriCiro)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .kpi-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
        .kpi-tile { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 8px; padding: 12px 14px; }
        .kpi-label { font-size: 10.5px; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .kpi-val { font-size: 22px; font-weight: 700; color: var(--color-fg); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.15; margin-top: 4px; }
        .kpi-sub { font-size: 11px; color: var(--color-muted-2); margin-top: 2px; }
        .bars-head { font-size: 10.5px; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 6px; border-bottom: 1px solid var(--color-border); margin-bottom: 6px; }
        .v3-bars { display: flex; flex-direction: column; gap: 4px; }
        .bar-row { display: grid; grid-template-columns: 200px 1fr 160px; align-items: center; gap: 12px; padding: 5px 0; font-size: 12.5px; }
        .bar-row:hover { background: var(--color-surface-2); margin: 0 -8px; padding: 5px 8px; border-radius: 6px; }
        .bar-label { display: inline-flex; align-items: center; gap: 6px; overflow: hidden; }
        .bar-name { font-weight: 500; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .bar-region { font-size: 10.5px; color: var(--color-muted-2); white-space: nowrap; }
        .bar-track { height: 14px; background: var(--color-surface-2); border-radius: 3px; overflow: hidden; position: relative; }
        .bar-fill { height: 100%; background: #16a34a; border-radius: 3px; opacity: 0.65; transition: width 0.3s ease-out; }
        .bar-meta { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 10px; font-variant-numeric: tabular-nums; }
        .bar-val { color: var(--color-fg); font-weight: 600; min-width: 50px; text-align: right; }
        .bar-ciro { color: var(--color-muted); font-size: 11.5px; min-width: 70px; text-align: right; }
        .empty { font-size: 12.5px; color: var(--color-muted); margin: 4px 0 0; }
      `,
        }}
      />
    </div>
  );
}
