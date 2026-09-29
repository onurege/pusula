import {
  RISK_TIER_COLORS,
  RISK_TIER_LABELS,
  RISK_TIER_LABELS_EN,
  VISIT_ORDER_TIER_COLORS,
  VISIT_ORDER_TIER_GUIDE,
  VISIT_ORDER_TIER_GUIDE_EN,
  VISIT_ORDER_TIER_LABELS,
  VISIT_ORDER_TIER_LABELS_EN,
  VISIT_ORDER_TIER_ORDER,
} from "./types";
import type { RiskTierBucket } from "./types";
import { t, type Locale } from "@/lib/i18n";

/**
 * Panel D — Risk Tier Dağılımı.
 *
 * İki paralel model (Strangler Fig):
 *   - composite (Pernod/fmcg-demo, AYNEN korunur): SQLite
 *     map_customers.risk_tier_v2 üzerinden GROUP BY (5 tier).
 *   - visit-order (Wietnauer, madde 13): ziyaret×sipariş 4 tier'ı — `buckets`
 *     bu durumda `page.tsx`'te `/api/map/customers`'tan LİVE hesaplanır
 *     (kullanıcının öncelik/tier-kapsamı/pencere seçimini yansıtır).
 *
 * Donut görselleştirme + her tier için müşteri sayısı + %. SVG donut
 * tek-pass arc'larla çizilir (recharts dependency'siz, server-renderable).
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function RiskTierPanel({
  buckets,
  locale = "tr",
  riskModel = "composite",
  windowDays,
  tiersInScope,
  priority,
}: {
  buckets: RiskTierBucket[];
  locale?: Locale;
  /** Madde 13 — hangi model render edilsin. Composite tenant'larda hiç
   *  geçirilmezse (varsayılan) eski davranış AYNEN kalır. */
  riskModel?: "composite" | "visit-order";
  /** visit-order modelinde alt başlıkta gösterilen pencere (gün). */
  windowDays?: number;
  /** "risk sayılan" tier'lar — seçili olanlar vurgulanır, diğerleri soluk. */
  tiersInScope?: readonly string[];
  /** Öncelik — dağılım severity sırasını belirler (ziyaret: ziyaret-yok daha
   *  riskli; sipariş: sipariş-yok daha riskli). */
  priority?: "visit" | "order";
}) {
  if (panelHidden("panel.risk.tier")) return null;
  if (riskModel === "visit-order") {
    return (
      <VisitOrderRiskTierPanel
        buckets={buckets}
        locale={locale}
        windowDays={windowDays}
        tiersInScope={tiersInScope}
        priority={priority}
      />
    );
  }
  const tierLabels = locale === "en" ? RISK_TIER_LABELS_EN : RISK_TIER_LABELS;
  // Tier display sırası — kötüden iyiye
  const order = ["critical", "risk", "watch", "healthy", "unknown"];
  const sorted = [...buckets].sort(
    (a, b) => order.indexOf(a.tier) - order.indexOf(b.tier),
  );
  const toplam = sorted.reduce((a, b) => a + b.musteriSayi, 0);

  // SVG donut geometri — viewBox 0 0 120 120, cx=60 cy=60 r=44, stroke 16
  const r = 44;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const arcs = sorted.map((bucket) => {
    const len = toplam > 0 ? (bucket.musteriSayi / toplam) * c : 0;
    const offset = c - acc;
    acc += len;
    return {
      ...bucket,
      dasharray: `${len} ${c - len}`,
      dashoffset: offset,
    };
  });

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.risk.tier", t(locale, "panel.risk.tier", "Risk Tier Dağılımı"))}</div>
          <div className="v3-panel-sub">
            map_customers.risk_tier_v2 · {toplam.toLocaleString("tr-TR")} {locale === "en" ? "customers" : "müşteri"}
          </div>
        </div>
      </div>

      {toplam === 0 ? (
        <div className="rt-empty">
          {locale === "en"
            ? "Risk scores not computed yet. The SQLite mirror needs to be synced."
            : "Risk skorları henüz hesaplanmamış. SQLite mirror'ın senkronize edilmesi gerekiyor."}
        </div>
      ) : (
        <div className="rt-wrap">
          <div className="rt-donut">
            <svg viewBox="0 0 120 120" width="160" height="160">
              <circle
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="16"
              />
              {arcs.map((a) => (
                <circle
                  key={a.tier}
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={RISK_TIER_COLORS[a.tier] ?? "#ccc"}
                  strokeWidth="16"
                  strokeDasharray={a.dasharray}
                  strokeDashoffset={a.dashoffset}
                  transform="rotate(-90 60 60)"
                />
              ))}
              <text
                x="60"
                y="58"
                textAnchor="middle"
                fontSize="18"
                fontWeight="700"
                fill="var(--color-fg)"
              >
                {toplam.toLocaleString("tr-TR")}
              </text>
              <text
                x="60"
                y="74"
                textAnchor="middle"
                fontSize="9"
                fill="var(--color-muted)"
              >
                {locale === "en" ? "customers" : "müşteri"}
              </text>
            </svg>
          </div>
          <div className="rt-legend">
            {sorted.map((b) => (
              <div key={b.tier} className="rt-row">
                <span
                  className="rt-dot"
                  style={{ background: RISK_TIER_COLORS[b.tier] ?? "#ccc" }}
                />
                <span className="rt-label">
                  {tierLabels[b.tier] ?? b.tier}
                </span>
                <span className="rt-sayi">
                  {b.musteriSayi.toLocaleString("tr-TR")}
                </span>
                <span className="rt-pct">%{b.payPct.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .rt-empty {
          font-size: 12.5px; color: var(--color-muted); padding: 16px 0;
        }
        .rt-wrap {
          display: flex; gap: 20px; align-items: center; flex-wrap: wrap;
        }
        .rt-donut { flex-shrink: 0; }
        .rt-legend {
          display: flex; flex-direction: column; gap: 8px;
          flex: 1; min-width: 180px;
        }
        .rt-row {
          display: grid;
          grid-template-columns: 12px 1fr auto auto;
          align-items: center;
          gap: 10px;
          font-size: 12.5px;
          padding: 4px 0;
          border-bottom: 1px dashed var(--color-border);
        }
        .rt-row:last-child { border-bottom: none; }
        .rt-dot { width: 10px; height: 10px; border-radius: 50%; }
        .rt-label { color: var(--color-fg); }
        .rt-sayi {
          color: var(--color-fg); font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .rt-pct {
          color: var(--color-muted); font-size: 11px;
          font-variant-numeric: tabular-nums;
          min-width: 42px; text-align: right;
        }
      `,
        }}
      />
    </div>
  );
}

/**
 * Madde 13 — "visit-order" risk modeli (Wietnauer) render'ı. Composite'in
 * (yukarıdaki) YERİNE geçer — aynı donut+legend iskeleti, yeni palet/etiket
 * + altta HER ZAMAN GÖRÜNÜR guide bloğu (13b — "kullanıcı anlıyor olsun").
 */
function VisitOrderRiskTierPanel({
  buckets,
  locale = "tr",
  windowDays,
  tiersInScope,
  priority,
}: {
  buckets: RiskTierBucket[];
  locale?: Locale;
  windowDays?: number;
  tiersInScope?: readonly string[];
  priority?: "visit" | "order";
}) {
  const tierLabels = locale === "en" ? VISIT_ORDER_TIER_LABELS_EN : VISIT_ORDER_TIER_LABELS;
  const guide = locale === "en" ? VISIT_ORDER_TIER_GUIDE_EN : VISIT_ORDER_TIER_GUIDE;
  // Öncelik severity sırasını belirler: ziyaret → ziyareti olmayan (turuncu)
  // daha riskli; sipariş → siparişi olmayan (sarı) daha riskli. Kırmızı hep en
  // riskli, yeşil hep en sağlıklı; ortadaki iki tier öncelikle yer değiştirir.
  const order: readonly string[] =
    priority === "order" ? ["red", "yellow", "orange", "green"] : (VISIT_ORDER_TIER_ORDER as readonly string[]);
  const sorted = [...buckets].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
  const toplam = sorted.reduce((a, b) => a + b.musteriSayi, 0);
  // "risk sayılan" tier'lar vurgulanır; seçilmeyenler soluk gösterilir.
  const inScope = (tier: string) => !tiersInScope || tiersInScope.includes(tier);

  const r = 44;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const arcs = sorted.map((bucket) => {
    const len = toplam > 0 ? (bucket.musteriSayi / toplam) * c : 0;
    const offset = c - acc;
    acc += len;
    return { ...bucket, dasharray: `${len} ${c - len}`, dashoffset: offset };
  });

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.risk.tier", t(locale, "panel.risk.tier", "Risk Tier Dağılımı"))}</div>
          <div className="v3-panel-sub">
            {windowDays != null
              ? t(locale, "risk.vo.subtitle", "Ziyaret + sipariş sinyali · son {days}g · {n} müşteri", {
                  days: windowDays,
                  n: toplam.toLocaleString("tr-TR"),
                })
              : `${toplam.toLocaleString("tr-TR")} ${locale === "en" ? "customers" : "müşteri"}`}
          </div>
        </div>
      </div>

      {toplam === 0 ? (
        <div className="rt-empty">
          {locale === "en"
            ? "Risk scores not computed yet. The SQLite mirror needs to be synced."
            : "Risk skorları henüz hesaplanmamış. SQLite mirror'ın senkronize edilmesi gerekiyor."}
        </div>
      ) : (
        <>
          <div className="rt-wrap">
            <div className="rt-donut">
              <svg viewBox="0 0 120 120" width="160" height="160">
                <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-border)" strokeWidth="16" />
                {arcs.map((a) => (
                  <circle
                    key={a.tier}
                    cx="60"
                    cy="60"
                    r={r}
                    fill="none"
                    stroke={VISIT_ORDER_TIER_COLORS[a.tier] ?? "#ccc"}
                    strokeWidth="16"
                    strokeDasharray={a.dasharray}
                    strokeDashoffset={a.dashoffset}
                    strokeOpacity={inScope(a.tier) ? 1 : 0.22}
                    transform="rotate(-90 60 60)"
                  />
                ))}
                <text x="60" y="58" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--color-fg)">
                  {toplam.toLocaleString("tr-TR")}
                </text>
                <text x="60" y="74" textAnchor="middle" fontSize="9" fill="var(--color-muted)">
                  {locale === "en" ? "customers" : "müşteri"}
                </text>
              </svg>
            </div>
            <div className="rt-legend">
              {sorted.map((b) => (
                <div
                  key={b.tier}
                  className="rt-row"
                  style={inScope(b.tier) ? undefined : { opacity: 0.4 }}
                >
                  <span className="rt-dot" style={{ background: VISIT_ORDER_TIER_COLORS[b.tier] ?? "#ccc" }} />
                  <span className="rt-label">
                    {tierLabels[b.tier] ?? b.tier}
                    {tiersInScope && inScope(b.tier) && (
                      <span className="rt-risk-tag">{locale === "en" ? "risk" : "risk"}</span>
                    )}
                  </span>
                  <span className="rt-sayi">{b.musteriSayi.toLocaleString("tr-TR")}</span>
                  <span className="rt-pct">%{b.payPct.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Madde 13b — guide: her tier'ın NEYE göre olduğu, her zaman
              görünür (hover/tooltip'e bağımlı değil — erişilebilir temel
              açıklama). */}
          <div className="rt-guide">
            <div className="rt-guide-title">{t(locale, "risk.vo.guide.title", "Nasıl hesaplanıyor?")}</div>
            <div className="rt-guide-grid">
              {(VISIT_ORDER_TIER_ORDER as readonly string[]).map((tier) => (
                <div key={tier} className="rt-guide-row">
                  <span className="rt-dot" style={{ background: VISIT_ORDER_TIER_COLORS[tier] ?? "#ccc" }} />
                  <span className="rt-guide-label">{tierLabels[tier] ?? tier}</span>
                  <span className="rt-guide-desc">{guide[tier] ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .rt-empty {
          font-size: 12.5px; color: var(--color-muted); padding: 16px 0;
        }
        .rt-wrap {
          display: flex; gap: 20px; align-items: center; flex-wrap: wrap;
        }
        .rt-donut { flex-shrink: 0; }
        .rt-legend {
          display: flex; flex-direction: column; gap: 8px;
          flex: 1; min-width: 180px;
        }
        .rt-row {
          display: grid;
          grid-template-columns: 12px 1fr auto auto;
          align-items: center;
          gap: 10px;
          font-size: 12.5px;
          padding: 4px 0;
          border-bottom: 1px dashed var(--color-border);
        }
        .rt-row:last-child { border-bottom: none; }
        .rt-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .rt-label { color: var(--color-fg); display: inline-flex; align-items: center; gap: 6px; }
        .rt-risk-tag {
          font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--color-bad, #dc2626);
          background: var(--color-bad-bg, rgba(220,38,38,0.1));
          border-radius: 4px; padding: 1px 5px;
        }
        .rt-sayi {
          color: var(--color-fg); font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .rt-pct {
          color: var(--color-muted); font-size: 11px;
          font-variant-numeric: tabular-nums;
          min-width: 42px; text-align: right;
        }
        .rt-guide {
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid var(--color-border);
        }
        .rt-guide-title {
          font-size: 11px; font-weight: 600; color: var(--color-muted);
          text-transform: uppercase; letter-spacing: 0.04em;
          margin-bottom: 8px;
        }
        .rt-guide-grid {
          display: grid; gap: 6px;
        }
        .rt-guide-row {
          display: grid;
          grid-template-columns: 10px auto 1fr;
          align-items: center;
          gap: 8px;
          font-size: 12px;
        }
        .rt-guide-label { color: var(--color-fg); font-weight: 500; white-space: nowrap; }
        .rt-guide-desc { color: var(--color-muted); }
      `,
        }}
      />
    </div>
  );
}
