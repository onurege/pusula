"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import type { KomutaPortfolioRow } from "@/lib/api";
import { InfoHint } from "../InfoHint";
import { trendColor } from "../trend-colors";

type Props = {
  portfolio: KomutaPortfolioRow[];
};

// Pastel tier — tooltip badge için (scatter bubble rengi tier'a göre değil,
// YoY'ye göre — ortak pastel palette)
const TIER_COLORS: Record<KomutaPortfolioRow["tier"], string> = {
  luxury: "#c084fc",
  premium: "#22d3ee",
  core: "#4ade80",
  value: "#d6d3d1",
};

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Mr`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} K`;
  return Math.round(n).toString();
}

/** Ürün grubu Execution Gap scatter — orijinal mockup'taki "stockout × margin"
 *  yerine elimizdeki gerçek datayla daha anlamlı bir versiyon:
 *
 *    X = Son 30g ciro (büyüklük — performansın boyutu)
 *    Y = YoY % (büyüme/düşüş trendi)
 *    Bubble boyutu = 2-yıllık değişim |%| (uzun vadeli volatilite)
 *    Renk = tier (luxury/premium/core/value)
 *
 *  Quadrant'lar:
 *    Sağ-üst  → Big & growing (KORU)
 *    Sağ-alt  → Big & declining (ACIL — büyük ciroda düşüş = en büyük kayıp)
 *    Sol-üst  → Small & growing (BÜYÜTMEK İÇİN YATIRIM YAP)
 *    Sol-alt  → Small & declining (gözden çıkarmaya değer mi sorgula)
 */
export function ExecutionGapScatter({ portfolio }: Props) {
  if (portfolio.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <span className="icon">🎯</span> Execution Gap
          </div>
        </div>
        <div className="empty-note">Ürün portföy verisi yok.</div>
      </div>
    );
  }

  const data = portfolio.map((p) => ({
    name: p.grup,
    tier: p.tier,
    x: p.bu, // son 30g ciro
    y: p.yoyPct ?? 0, // YoY %
    z: Math.max(20, Math.min(200, Math.abs(p.twoYrPct ?? 30) * 2)), // bubble size
    twoYrPct: p.twoYrPct,
    // Bubble rengi YoY trend pastel paletinden (treemap + harita ile aynı)
    color: trendColor(p.yoyPct),
  }));

  const maxCiro = Math.max(...data.map((d) => d.x), 1);

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🎯</span> Execution Gap · Ürün Grubu Aksiyon Matrisi
          <InfoHint
            title="Execution Gap mantığı"
            source="Komuta Portfolio (TBLMSDFATURA × TBLURUNGRUP, 2 yıllık)"
            window="X: son 30g · Y: son 30g vs geçen yıl aynı 30g"
            base="X = SUM(DBLNETFIYAT) son 30g · Y = YoY% · Bubble = |2-yıllık %|"
            notes={[
              "Sağ-üst (Koru): büyük ciro × büyüme → strateji devam",
              "Sağ-alt (Acil): büyük ciro × düşüş → en büyük gelir kaybı, hemen aksiyon",
              "Sol-üst (Yatırım): küçük ciro × büyüme → potansiyeli olan grup",
              "Sol-alt (Sorgula): küçük × düşüş → portföy temizlik adayı",
              "Bubble boyutu 2-yıllık değişim oranıyla (volatilite göstergesi)",
            ]}
          />
        </div>
        <div className="panel-meta">{portfolio.length} ürün grubu</div>
      </div>

      <div style={{ width: "100%", minWidth: 0 }}>
        <ResponsiveContainer width="100%" aspect={2.2} minWidth={200}>
          <ScatterChart margin={{ top: 16, right: 20, bottom: 40, left: 50 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
            />
            {/* Quadrant ayırıcı çizgiler — y=0 (YoY=0), x=median ciro */}
            <ReferenceLine
              y={0}
              stroke="var(--color-muted)"
              strokeDasharray="4 4"
              label={{
                value: "YoY = 0",
                position: "left",
                fill: "var(--color-muted)",
                fontSize: 10,
              }}
            />
            {/* Sağ-alt "Acil" alanı — büyük ciro × negatif YoY */}
            <ReferenceArea
              x1={maxCiro / 2}
              x2={maxCiro}
              y1={-100}
              y2={0}
              fill="#f87171"
              fillOpacity={0.1}
              ifOverflow="visible"
            />

            <XAxis
              type="number"
              dataKey="x"
              name="Son 30g Ciro"
              tickFormatter={(v) => `${compact(Number(v))} ₺`}
              tick={{ fontSize: 10.5, fill: "var(--color-muted)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              label={{
                value: "Son 30g Ciro →",
                position: "insideBottom",
                offset: -25,
                fill: "var(--color-muted)",
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="YoY %"
              tickFormatter={(v) => `${v >= 0 ? "+" : ""}%${v}`}
              tick={{ fontSize: 10.5, fill: "var(--color-muted)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
              label={{
                value: "↑ YoY %",
                position: "insideLeft",
                angle: -90,
                offset: 10,
                fill: "var(--color-muted)",
                fontSize: 11,
              }}
            />
            <ZAxis dataKey="z" range={[60, 400]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ payload }) => {
                const item = payload?.[0]?.payload as
                  | {
                      name: string;
                      tier: KomutaPortfolioRow["tier"];
                      x: number;
                      y: number;
                      twoYrPct: number | null;
                    }
                  | undefined;
                if (!item) return null;
                let quadrant = "";
                if (item.x >= maxCiro / 2) {
                  quadrant = item.y >= 0 ? "✅ KORU (büyük × büyüyor)" : "⚠ ACİL (büyük × düşüyor)";
                } else {
                  quadrant = item.y >= 0 ? "🌱 YATIRIM (küçük × büyüyor)" : "🗑 SORGULA (küçük × düşüyor)";
                }
                return (
                  <div
                    style={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border-strong)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 11.5,
                      minWidth: 200,
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
                    <div style={{ color: "var(--color-fg-2)", fontVariantNumeric: "tabular-nums" }}>
                      Son 30g: <strong>{compact(item.x)} ₺</strong>
                    </div>
                    <div
                      style={{
                        color: item.y >= 0 ? "var(--color-good)" : "var(--color-bad)",
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      YoY: {item.y >= 0 ? "+" : ""}
                      %{item.y.toFixed(1)}
                    </div>
                    {item.twoYrPct != null && (
                      <div
                        style={{
                          color: "var(--color-muted)",
                          fontSize: 10.5,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        2-yıllık: {item.twoYrPct >= 0 ? "+" : ""}
                        %{item.twoYrPct.toFixed(1)}
                      </div>
                    )}
                    <div
                      style={{
                        marginTop: 6,
                        paddingTop: 6,
                        borderTop: "1px dashed var(--color-border)",
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: "var(--color-fg)",
                      }}
                    >
                      {quadrant}
                    </div>
                  </div>
                );
              }}
            />
            <Scatter data={data} fill="#6366f1">
              {data.map((entry, i) => (
                <Cell
                  key={`c-${i}`}
                  fill={entry.color}
                  fillOpacity={0.8}
                  stroke={entry.color}
                  strokeWidth={1.5}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Quadrant açıklamaları */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginTop: 10,
          fontSize: 10.5,
        }}
      >
        <QuadrantNote
          label="🌱 SOL-ÜST · Yatırım"
          desc="Küçük ciro + büyüyor — potansiyel"
          color="var(--color-good)"
        />
        <QuadrantNote
          label="✅ SAĞ-ÜST · Koru"
          desc="Büyük ciro + büyüyor — strateji çalışıyor"
          color="var(--color-good)"
        />
        <QuadrantNote
          label="🗑 SOL-ALT · Sorgula"
          desc="Küçük ciro + düşüyor — portföy temizlik adayı"
          color="var(--color-muted)"
        />
        <QuadrantNote
          label="⚠ SAĞ-ALT · Acil"
          desc="Büyük ciro + düşüyor — en büyük kayıp"
          color="var(--color-bad)"
        />
      </div>
    </div>
  );
}

function QuadrantNote({
  label,
  desc,
  color,
}: {
  label: string;
  desc: string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "6px 10px",
        background: "var(--color-surface-2)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--color-fg)", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ color: "var(--color-muted)", fontSize: 10 }}>{desc}</div>
    </div>
  );
}
