"use client";

import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { KomutaPortfolioRow } from "@/lib/api";
import { InfoHint } from "../InfoHint";
import { TREND_LEGEND, trendColor } from "../trend-colors";

type Props = {
  portfolio: KomutaPortfolioRow[];
};

// Pastel tier renkleri (badge için — solid değil tinted)
const TIER_COLORS: Record<KomutaPortfolioRow["tier"], string> = {
  luxury: "#c084fc",   // purple-400 pastel
  premium: "#22d3ee",  // cyan-400 pastel
  core: "#4ade80",     // green-400 pastel (aynı trend pos-strong ile)
  value: "#d6d3d1",    // stone-300 pastel (aynı trend neutral ile)
};

const TIER_LABELS: Record<KomutaPortfolioRow["tier"], string> = {
  luxury: "LUX",
  premium: "PREM",
  core: "CORE",
  value: "VALUE",
};

// Renklendirme ortak pastel palette'ten (trend-colors.ts). Daha önce
// inline deltaColor vardı, kaldırıldı; tüm trend grafikler (treemap, scatter,
// harita) aynı pastel paleti paylaşır.

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Mr ₺`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M ₺`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} K ₺`;
  return `${Math.round(n)} ₺`;
}

/** Ürün grubu treemap — son 30g cirosuyla orantılı dikdörtgenler.
 *  Renk = tier (luxury/premium/core/value), boyut = ciro.
 *  Recharts Treemap kullanır; KomutaPortfolioRow.bu son 30g cirosudur. */
export function ProductTreemap({ portfolio }: Props) {
  if (portfolio.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <span className="icon">🟦</span> Ürün Grubu Treemap
          </div>
        </div>
        <div className="empty-note">Portföy verisi yok.</div>
      </div>
    );
  }

  // Treemap data shape — Recharts standart {name, size, fill}.
  // Renk YoY'ye göre (yeşil büyüyen / kırmızı düşen) — Komuta map ile
  // tutarlı + tier classification'ın demo data'da yetersiz kalmasını
  // by-pass eder.
  const data = portfolio.map((p) => ({
    name: p.grup,
    size: p.bu,
    tier: p.tier,
    yoyPct: p.yoyPct,
    twoYrPct: p.twoYrPct,
    fill: trendColor(p.yoyPct),
  }));

  const total = portfolio.reduce((a, p) => a + p.bu, 0);

  // Name → fill lookup (en güvenli yöntem — Recharts v3 props inconsistency)
  const fillByName = new Map(data.map((d) => [d.name, d.fill]));
  const itemByName = new Map(data.map((d) => [d.name, d]));

  // Closure-based content — Recharts custom content'e payload tutarsız geçiyor
  // (v3). 4 aşamalı fallback ile fill'i bulmaya çalışıyoruz.
  const renderCell = (cellProps: unknown) => {
    const cp = cellProps as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      depth?: number;
      index?: number;
      name?: string;
      fill?: string;
      tier?: KomutaPortfolioRow["tier"];
      payload?: { name?: string; fill?: string; tier?: KomutaPortfolioRow["tier"] };
    };
    const { x = 0, y = 0, width = 0, height = 0, depth = 0, index } = cp;
    if (depth === 0 || width <= 0 || height <= 0) return <g />;

    // FILL fallback chain:
    //   1. Direct props.fill (en yeni Recharts versiyonları)
    //   2. props.payload.fill
    //   3. fillByName lookup (props.name varsa)
    //   4. fillByName lookup (props.payload.name varsa)
    //   5. tier'dan direkt lookup
    //   6. data[index] lookup
    //   7. fallback gri
    const cellName = cp.name ?? cp.payload?.name ?? "";
    const cellTier = cp.tier ?? cp.payload?.tier;
    const color =
      cp.fill ||
      cp.payload?.fill ||
      (cellName && fillByName.get(cellName)) ||
      (cellTier && TIER_COLORS[cellTier]) ||
      (typeof index === "number" && data[index]?.fill) ||
      "#a8a29e";

    // Item resolution (label + tooltip için)
    const item =
      (cellName && itemByName.get(cellName)) ||
      (typeof index === "number" ? data[index] : undefined);
    if (!item) return <g />;
    const showLabel = width > 60 && height > 30;
    const showYoY = width > 80 && height > 50 && item.yoyPct != null;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={color}
          fillOpacity={0.88}
          stroke="var(--color-surface)"
          strokeWidth={2}
        />
        {showLabel && (
          <>
            <text
              x={x + 8}
              y={y + 18}
              fill="white"
              fontSize={11}
              fontWeight={700}
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                textShadow: "0 1px 2px rgba(0,0,0,0.4)",
              }}
            >
              {item.name.length > Math.floor(width / 7)
                ? item.name.slice(0, Math.floor(width / 7) - 1) + "…"
                : item.name}
            </text>
            <text
              x={x + 8}
              y={y + 32}
              fill="rgba(255,255,255,0.95)"
              fontSize={10}
              style={{ fontFamily: "Inter, system-ui, sans-serif" }}
            >
              {compact(item.size)}
            </text>
            {showYoY && (
              <text
                x={x + 8}
                y={y + 46}
                fill="rgba(255,255,255,0.9)"
                fontSize={9.5}
                fontWeight={600}
                style={{ fontFamily: "Inter, system-ui, sans-serif" }}
              >
                {item.yoyPct! >= 0 ? "+" : ""}%{item.yoyPct!.toFixed(0)} YoY
              </text>
            )}
          </>
        )}
      </g>
    );
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🟦</span> Ürün Grubu Treemap · Son 30g Net Ciro
          <InfoHint
            title="Treemap hesaplaması"
            source="TBLMSDFATURA × TBLMSDBELGEDETAY × TBLURUN × TBLURUNGRUP"
            window="Son 30 gün vs geçen yıl aynı 30 gün"
            base="SUM(DBLNETFIYAT) ürün grubu bazında"
            notes={[
              "Top 10 ürün grubu, alan büyüklüğü son 30g cirosuyla orantılı",
              "Renkler YoY %'ye göre — yeşil büyüyen / kırmızı düşen (Komuta map skala)",
              "Tier badge'i (LUX/PREM/CORE) cell üstünde, tooltip'te tier detayı",
              "Hover ile son 30g + geçen yıl + 2-yıllık değişim",
            ]}
          />
        </div>
        <div className="panel-meta">Top {portfolio.length} grup · toplam {compact(total)}</div>
      </div>

      {/* ResponsiveContainer height:"100%" parent measurement'ı timing
          sorununda -1 alır. aspect=2.4 ile sabit en-boy oranı: parent'tan
          sadece width okur, height'ı kendisi hesaplar — RSC hydration
          sorununu by-pass eder. */}
      <div style={{ width: "100%", minWidth: 0 }}>
        <ResponsiveContainer width="100%" aspect={2.4} minWidth={200}>
          <Treemap
            data={data}
            dataKey="size"
            stroke="var(--color-surface)"
            content={renderCell as never}
          >
            <Tooltip
              content={({ payload }) => {
                const item = payload?.[0]?.payload as
                  | {
                      name: string;
                      size: number;
                      tier: KomutaPortfolioRow["tier"];
                      yoyPct: number | null;
                      twoYrPct: number | null;
                    }
                  | undefined;
                if (!item) return null;
                return (
                  <div
                    style={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border-strong)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 11.5,
                      minWidth: 180,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        color: "var(--color-fg)",
                        marginBottom: 4,
                      }}
                    >
                      {item.name}
                    </div>
                    <div style={{ color: "var(--color-fg-2)" }}>
                      Tier:{" "}
                      <strong style={{ color: TIER_COLORS[item.tier] }}>
                        {TIER_LABELS[item.tier]}
                      </strong>
                    </div>
                    <div style={{ color: "var(--color-fg-2)" }}>
                      Son 30g:{" "}
                      <strong
                        style={{
                          color: "var(--color-fg)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {compact(item.size)}
                      </strong>
                    </div>
                    {item.yoyPct != null && (
                      <div
                        style={{
                          color:
                            item.yoyPct >= 0
                              ? "var(--color-good)"
                              : "var(--color-bad)",
                          fontWeight: 600,
                        }}
                      >
                        YoY: {item.yoyPct >= 0 ? "+" : ""}
                        %{item.yoyPct.toFixed(1)}
                      </div>
                    )}
                    {item.twoYrPct != null && (
                      <div
                        style={{
                          color:
                            item.twoYrPct >= 0
                              ? "var(--color-good)"
                              : "var(--color-bad)",
                          fontSize: 10.5,
                          opacity: 0.85,
                        }}
                      >
                        2-yıllık: {item.twoYrPct >= 0 ? "+" : ""}
                        %{item.twoYrPct.toFixed(1)}
                      </div>
                    )}
                  </div>
                );
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>

      {/* YoY renk skala legend — ortak pastel palette */}
      <div
        style={{
          display: "flex",
          gap: 14,
          marginTop: 10,
          flexWrap: "wrap",
          fontSize: 10.5,
          color: "var(--color-muted)",
        }}
      >
        {TREND_LEGEND.map((s) => (
          <LegendSwatch key={s.bucket} color={s.hex} label={s.label} />
        ))}
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          background: color,
          borderRadius: 2,
        }}
      />
      {label}
    </span>
  );
}

