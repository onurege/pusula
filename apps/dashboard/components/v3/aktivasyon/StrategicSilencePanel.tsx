import type { StrategicBrandSilence } from "./types";

/**
 * Panel C — Stratejik Marka Sessizliği.
 *
 * Tenant config'teki her stratejik marka için "bu markadan önceden alan ama
 * son 90g sessizleşen" müşteri sayısı. Yatay bar — yüksek sessizlik = saha
 * önceliği.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function StrategicSilencePanel({
  items,
}: {
  items: StrategicBrandSilence[];
}) {
  if (panelHidden("panel.risk.strategic")) return null;
  // En kötüden iyiye sırala
  const sorted = [...items].sort((a, b) => b.sessizMusteri - a.sessizMusteri);
  const maxSessiz = Math.max(1, ...sorted.map((b) => b.sessizMusteri));

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.risk.strategic", "Stratejik Marka Sessizliği")}</div>
          <div className="v3-panel-sub">
            Önceden alan ama son 90 gün sessiz · stratejik markalar için
            saha aksiyon listesi
          </div>
        </div>
      </div>

      {sorted.length === 0 && (
        <div className="ss-empty">
          Stratejik marka tanımı yok veya bu dönem için veri bulunamadı.
        </div>
      )}

      <div className="ss-bars">
        {sorted.map((b) => (
          <div key={b.marka} className="ss-row">
            <div className="ss-label" title={b.marka}>
              <span className="strat-dot" />
              {b.marka}
            </div>
            <div className="ss-track">
              <div
                className="ss-fill"
                style={{ width: `${(b.sessizMusteri / maxSessiz) * 100}%` }}
              />
            </div>
            <div className="ss-meta">
              <span className="ss-sessiz">{b.sessizMusteri}</span>
              <span className="ss-toplam">/ {b.toplamMusteri}</span>
              <span className="ss-pct">%{b.sessizPct.toFixed(0)}</span>
            </div>
          </div>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .ss-empty {
          font-size: 12.5px;
          color: var(--color-muted);
          padding: 12px 0;
        }
        .ss-bars { display: flex; flex-direction: column; gap: 8px; }
        .ss-row {
          display: grid;
          grid-template-columns: minmax(120px, 1.2fr) 2fr auto;
          align-items: center;
          gap: 12px;
          font-size: 12.5px;
        }
        .ss-label {
          display: flex; align-items: center; gap: 6px;
          color: var(--color-fg);
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .strat-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--color-accent);
          flex-shrink: 0;
        }
        .ss-track {
          height: 10px;
          background: var(--color-border);
          border-radius: 4px;
          overflow: hidden;
        }
        .ss-fill {
          height: 100%;
          background: #FAC775;
          border-radius: 4px;
        }
        .ss-meta {
          display: flex;
          gap: 4px;
          align-items: baseline;
          font-variant-numeric: tabular-nums;
        }
        .ss-sessiz { font-weight: 700; color: var(--color-fg); font-size: 13.5px; }
        .ss-toplam { color: var(--color-muted-2); font-size: 11.5px; }
        .ss-pct {
          margin-left: 6px;
          padding: 1px 6px;
          background: var(--color-border);
          border-radius: 3px;
          color: var(--color-muted);
          font-size: 11px;
          font-weight: 600;
        }
      `,
        }}
      />
    </div>
  );
}
