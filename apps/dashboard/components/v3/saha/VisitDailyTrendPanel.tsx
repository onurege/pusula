import type { SahaVisitDailyRow, SahaVisitKpi } from "@/lib/api";

/**
 * Panel A — Son 30g günlük ziyaret trendi (stacked bar: rut içi vs rut dışı).
 *
 * Server-rendered SVG; etkileşim yok (V3 dashboard mantığına uygun, hover
 * için sadece <title> tooltipi).
 *
 * Renkler (Wietnauer brief'inden):
 *   - Rut içi:  #9FE1CB  (planlı rut)
 *   - Rut dışı: #FAC775  (rut dışı / fırsat ziyareti)
 *
 * Header'da son 7g KPI özet 4 mini-card halinde.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function VisitDailyTrendPanel({
  rows,
  kpi,
}: {
  rows: SahaVisitDailyRow[];
  kpi: SahaVisitKpi;
}) {
  if (panelHidden("panel.saha.daily")) return null;
  const max = Math.max(1, ...rows.map((r) => r.toplam));
  // Hafta sonu (Cumartesi/Pazar) ayrı renk için
  const isWeekend = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    const day = d.getDay();
    return day === 0 || day === 6;
  };
  const fmtGun = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "short",
    });

  const toplamRutIci = rows.reduce((a, r) => a + r.rutIci, 0);
  const toplamRutDisi = rows.reduce((a, r) => a + r.rutDisi, 0);
  const toplam30g = toplamRutIci + toplamRutDisi;
  const rutDisiPct = toplam30g > 0 ? (toplamRutDisi / toplam30g) * 100 : 0;

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.saha.daily", "Günlük Ziyaret Trendi")}</div>
          <div className="v3-panel-sub">
            Son 30 gün · {toplam30g.toLocaleString("tr-TR")} ziyaret · Rut dışı
            payı <strong>%{rutDisiPct.toFixed(1)}</strong>
          </div>
        </div>
        <div className="v3-panel-legend">
          <span className="lg lg-rut">
            <span className="dot" style={{ background: "#9FE1CB" }} /> Rut içi
          </span>
          <span className="lg lg-rd">
            <span className="dot" style={{ background: "#FAC775" }} /> Rut dışı
          </span>
        </div>
      </div>

      <div className="saha-kpi-row">
        <KpiMini label="Son 7g ziyaret" value={kpi.son7gZiyaret.toLocaleString("tr-TR")} />
        <KpiMini
          label="Son 7g müşteri"
          value={kpi.son7gUniqueMusteri.toLocaleString("tr-TR")}
        />
        <KpiMini
          label="Aktif temsilci"
          value={kpi.son7gAktifTemsilci.toLocaleString("tr-TR")}
        />
        <KpiMini
          label="Sipariş dönüşüm"
          value={`%${kpi.son7gDonusumPct.toFixed(1)}`}
          accent
        />
      </div>

      <div className="saha-bars">
        {rows.map((r) => {
          const totalH = (r.toplam / max) * 100;
          const rutIciH = r.toplam > 0 ? (r.rutIci / r.toplam) * totalH : 0;
          const rutDisiH = r.toplam > 0 ? (r.rutDisi / r.toplam) * totalH : 0;
          const we = isWeekend(r.gun);
          return (
            <div
              key={r.gun}
              className={`saha-bar-col ${we ? "weekend" : ""}`}
              title={`${fmtGun(r.gun)} — ${r.toplam} ziyaret (rut içi: ${r.rutIci}, rut dışı: ${r.rutDisi})`}
            >
              <div className="saha-bar-stack">
                <div
                  className="saha-bar-rd"
                  style={{
                    height: `${rutDisiH}%`,
                    background: "#FAC775",
                  }}
                />
                <div
                  className="saha-bar-ri"
                  style={{
                    height: `${rutIciH}%`,
                    background: "#9FE1CB",
                  }}
                />
              </div>
              <div className="saha-bar-label">
                {fmtGun(r.gun).replace(/\s/g, " ")}
              </div>
            </div>
          );
        })}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 18px 20px;
        }
        .v3-panel-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }
        .v3-panel-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--color-fg);
        }
        .v3-panel-sub {
          font-size: 12px;
          color: var(--color-muted);
          margin-top: 2px;
          line-height: 1.45;
        }
        .v3-panel-legend {
          display: flex;
          gap: 12px;
          font-size: 11px;
          color: var(--color-muted);
        }
        .v3-panel-legend .lg { display: inline-flex; align-items: center; gap: 5px; }
        .v3-panel-legend .dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 2px;
        }
        .saha-kpi-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 16px;
        }
        @media (max-width: 720px) {
          .saha-kpi-row { grid-template-columns: repeat(2, 1fr); }
        }
        .saha-kpi-mini {
          background: var(--color-surface-2);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .saha-kpi-mini.accent {
          background: var(--color-accent-soft, rgba(159, 225, 203, 0.18));
        }
        .saha-kpi-mini .lbl {
          font-size: 10px;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 600;
        }
        .saha-kpi-mini .val {
          font-size: 18px;
          font-weight: 700;
          color: var(--color-fg);
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
        }
        .saha-kpi-mini.accent .val { color: var(--color-accent); }
        .saha-bars {
          display: grid;
          grid-template-columns: repeat(${rows.length || 1}, 1fr);
          gap: 3px;
          height: 220px;
          align-items: end;
        }
        .saha-bar-col {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 4px;
          height: 100%;
          min-width: 0;
          cursor: default;
        }
        .saha-bar-stack {
          flex: 1;
          display: flex;
          flex-direction: column-reverse;
          justify-content: flex-start;
          min-height: 0;
          background: var(--color-surface-2);
          border-radius: 3px 3px 0 0;
          overflow: hidden;
          transition: opacity 0.15s;
        }
        .saha-bar-col:hover .saha-bar-stack { opacity: 0.82; }
        .saha-bar-ri, .saha-bar-rd { width: 100%; }
        .saha-bar-rd { border-radius: 3px 3px 0 0; }
        .saha-bar-label {
          font-size: 9px;
          color: var(--color-muted-2);
          text-align: center;
          line-height: 1.2;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
          overflow: hidden;
          white-space: nowrap;
        }
        .saha-bar-col.weekend .saha-bar-label {
          color: var(--color-bad, #dc2626);
          opacity: 0.75;
        }
      `,
        }}
      />
    </div>
  );
}

function KpiMini({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`saha-kpi-mini ${accent ? "accent" : ""}`}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
    </div>
  );
}
