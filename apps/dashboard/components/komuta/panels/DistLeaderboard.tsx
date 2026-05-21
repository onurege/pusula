import type { KomutaTopDist, ValueUnit } from "@/lib/api";
import { InfoHint } from "../InfoHint";
import { Val } from "../format";

export function DistLeaderboard({
  dists,
  unit = "tl",
}: {
  dists: KomutaTopDist[];
  unit?: ValueUnit;
}) {
  const max = Math.max(1, ...dists.map((d) => d.ciro));
  return (
    <div className="panel leaderboard">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🏢</span> Top Distribütörler
          <InfoHint
            title="Distribütör sıralaması"
            source="TBLMSDFATURA × TBLDIST × TBLDISTGRUP"
            window="Son 30 gün"
            base="SUM(DBLNETTUTAR) her distribütör için + COUNT fatura"
            notes={[
              "Filtre: f.BYTTUR=0, f.BYTDURUM=0, d.BYTDURUM=0",
              "Bölge etiketi (TBLDISTGRUP.TXTAD) liste satırında görünür",
              "Top 10; sıralama ciro DESC",
            ]}
          />
        </div>
        <div className="panel-meta">Son 30g · ciro sırası</div>
      </div>
      {dists.length === 0 ? (
        <div className="empty-note">Distribütör verisi yok.</div>
      ) : (
        dists.map((d) => {
          const pct = (d.ciro / max) * 100;
          const tone = pct >= 70 ? "" : pct >= 40 ? " warn" : " bad";
          const pctTone = pct >= 70 ? "" : pct >= 40 ? "warn" : "bad";
          return (
            <div key={d.ad + d.rank} className="lb-row">
              <div className={`lb-rank${d.rank === 1 ? " top1" : d.rank === 2 ? " top2" : d.rank === 3 ? " top3" : ""}`}>
                {d.rank}
              </div>
              <div>
                <div className="lb-name">{d.ad}</div>
                {d.bolge && <span className="lb-region">{d.bolge}</span>}
              </div>
              <div className="lb-bar">
                <div className={`lb-bar-fill${tone}`} style={{ width: `${pct}%` }} />
              </div>
              <div className={`lb-pct ${pctTone}`}><Val n={d.ciro} unit={unit} /></div>
            </div>
          );
        })
      )}
    </div>
  );
}
