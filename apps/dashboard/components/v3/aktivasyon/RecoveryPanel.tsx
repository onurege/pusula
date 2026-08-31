import { formatCompact } from "@/components/komuta/format";
import { RISK_TIER_COLORS, RISK_TIER_LABELS } from "./types";
import type { RecoveryTarget } from "./types";

/**
 * Panel E — Yeniden Kazanım Fırsatları.
 *
 * SQLite mirror'dan yüksek ciro_t90 + days_since_last_sale > 60 olan müşteriler.
 * Saha ekibinin "önce şuna git" listesi. Her satırda risk_tier_v2 chip ile
 * brief'teki renk paletinde işaretlenir.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function RecoveryPanel({ items }: { items: RecoveryTarget[] }) {
  if (panelHidden("panel.risk.recovery")) return null;
  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.risk.recovery", "Yeniden Kazanım Fırsatları")}</div>
          <div className="v3-panel-sub">
            Yüksek geçmiş cirosu + 60g+ sessizlik · Top {items.length} müşteri
          </div>
        </div>
      </div>

      <div className="v3-table-wrap">
        <table className="v3-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Müşteri</th>
              <th>Şehir</th>
              <th className="num">Ciro (90g)</th>
              <th className="num">Sessiz</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Mirror henüz hesaplanmamış veya bu kriterlere uyan müşteri yok.
                </td>
              </tr>
            )}
            {items.map((c, i) => {
              const tier = c.riskTier || "unknown";
              const color = RISK_TIER_COLORS[tier] ?? "#E6E4DC";
              const label = RISK_TIER_LABELS[tier] ?? tier;
              return (
                <tr key={c.id}>
                  <td className="rank">{i + 1}</td>
                  <td className="unvan" title={c.unvan}>
                    {c.unvan.length > 42 ? c.unvan.slice(0, 39) + "…" : c.unvan}
                  </td>
                  <td>{c.sehir || "—"}</td>
                  <td className="num">₺{formatCompact(c.cirot90)}</td>
                  <td className="num">{c.sessizGun}g</td>
                  <td>
                    <span
                      className="risk-chip"
                      style={{
                        background: color,
                        color: "#1c1c1c",
                      }}
                    >
                      {label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .risk-chip {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .empty {
          text-align: center;
          color: var(--color-muted);
          padding: 20px 0;
          font-size: 12.5px;
        }
      `,
        }}
      />
    </div>
  );
}
