import type { KomutaRep, ValueUnit } from "@/lib/api";
import { InfoHint } from "../InfoHint";
import { Val } from "../format";

export function RepLeaderboard({
  reps,
  unit = "tl",
}: {
  reps: KomutaRep[];
  unit?: ValueUnit;
}) {
  // Panel sözleşmesi "Top 10" — kaynak fazla satır dönse de ilk 10 gösterilir.
  const topReps = reps.slice(0, 10);
  const max = Math.max(1, ...topReps.map((r) => r.ciro));
  return (
    <div className="panel leaderboard">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🏆</span> Top Satış Temsilcileri
          <InfoHint
            title="Satış temsilcisi sıralaması"
            source="TBLMSDFATURA × TBLSATISTEMSILCISI × TBLDIST"
            window="Son 30 gün"
            base="SUM(DBLNETTUTAR) her temsilci için + COUNT fatura"
            notes={[
              "Filtre: f.BYTTUR=0, f.BYTDURUM=0, s.BYTDURUM=0 (aktif temsilci)",
              "Top 10; sıralama ciro DESC",
            ]}
          />
        </div>
        <div className="panel-meta">Son 30g · ciro sırası</div>
      </div>
      {topReps.length === 0 ? (
        <div className="empty-note">Temsilci verisi yok.</div>
      ) : (
        topReps.map((r) => {
          const pct = (r.ciro / max) * 100;
          const tone = pct >= 70 ? "" : pct >= 40 ? " warn" : " bad";
          const pctTone = pct >= 70 ? "" : pct >= 40 ? "warn" : "bad";
          return (
            <div key={r.ad + r.rank} className="lb-row">
              <div className={`lb-rank${r.rank === 1 ? " top1" : r.rank === 2 ? " top2" : r.rank === 3 ? " top3" : ""}`}>
                {r.rank}
              </div>
              <div>
                <div className="lb-name">{r.ad}</div>
                {r.distributor && <span className="lb-region">{r.distributor}</span>}
              </div>
              <div className="lb-bar">
                <div className={`lb-bar-fill${tone}`} style={{ width: `${pct}%` }} />
              </div>
              <div className={`lb-pct ${pctTone}`}><Val n={r.ciro} unit={unit} /></div>
            </div>
          );
        })
      )}
    </div>
  );
}
