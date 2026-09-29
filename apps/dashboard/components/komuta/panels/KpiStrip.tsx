import type { KomutaKpiCard } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { InfoHint } from "../InfoHint";
import { KpiValue } from "../format";

const accents = ["#6366f1", "#16a34a", "#9333ea", "#6366f1", "#16a34a"];

export function KpiStrip({ kpis }: { kpis: KomutaKpiCard[] }) {
  if (!kpis || kpis.length === 0) {
    return <div className="empty-note">KPI verisi alınamadı.</div>;
  }
  // Hacim birimi tenant'a göre değişir (Pernod "9L", Wietnauer "70cl") —
  // sabit "9L" metni tenant-nötr KISIT'i ihlal eder, bkz. tenant.volume.
  const tenant = getTenantConfig();
  const volShort = tenant.volume.short;
  return (
    <div className="kpi-strip-wrap">
      <div className="kpi-strip-head">
        <span className="kpi-strip-label">Son 30 gün özet</span>
        <InfoHint
          title="KPI hesaplaması"
          source={`TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUNEKSAHA (${volShort} için)`}
          window="Son 30 gün vs önceki 30 gün (delta % hesabı)"
          base={`SUM(DBLNETTUTAR) (Ciro), COUNT (Fatura), SUM(DBLMIKTAR × ek_saha_26) (Hacim = ${volShort})`}
          notes={[
            "Filtre: BYTTUR=0 AND BYTDURUM=0 (onaylı satış faturası)",
            tenant.volume.hint,
            "Fallback (ek saha boş ise): DBLLITRE / 9 klasik hesaba düşülür",
            "Demo modda GETDATE() çağrıları DEMO_DATE env değerine rewrite edilir",
          ]}
        />
      </div>
      <div className="kpi-strip">
        {kpis.map((k, i) => (
          <div
            key={k.id}
            className="kpi-card"
            style={{ ["--accent" as string]: accents[i] ?? "#6366f1" }}
          >
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value"><KpiValue k={k} /></div>
            <div className="kpi-meta">
              {k.delta != null && (
                <span className={k.delta >= 0 ? "delta-up" : "delta-down"}>
                  {k.delta >= 0 ? "▲" : "▼"} %{Math.abs(k.delta).toFixed(1)}
                </span>
              )}
              {k.deltaSub && <span className="kpi-sub">{k.deltaSub}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
