"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { KomutaMonthlyBar, ValueUnit } from "@/lib/api";

type Props = {
  monthly: KomutaMonthlyBar[];
  unit?: ValueUnit;
};

/**
 * Takvim — Bu Yıl vs Geçen Yıl smooth area chart.
 *
 * Görsel stil:
 *   - Bu Yıl   : indigo solid line + light gradient area
 *   - Geçen Yıl: amber dotted line, area yok (referans çizgi)
 *   - Bugün    : son veri noktasında belirgin dot + label
 *   - Yaz Pik  : ReferenceArea (Haz-Eyl yumuşak band)
 *   - Ramazan  : ReferenceArea (vurgulu mor band)
 *   - Bayram   : ReferenceDot (Yılbaşı, 14 Şub, 29 Ekim)
 *
 * Hesap kaynağı:
 *   - TBLMSDFATURA SUM(DBLNETTUTAR) son 24 ay
 *   - Her ay için 12 ay önceki aynı ay = ciroPrev (geçen yıl hizalı)
 *   - BYTTUR=0 AND BYTDURUM=0
 */
/** Tema-bağımlı renkler — Recharts hardcoded hex bekler; tema değiştiğinde
 *  re-render için state'te tutuyoruz. */
function readChartColors() {
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark";
  return isDark
    ? {
        grid: "#27272a",
        axis: "#3f3f46",
        axisTick: "#a1a1aa",
        yTick: "#71717a",
        primary: "#818cf8", // indigo-400
        primaryFill: "url(#cal-gradient-buyil)",
        prev: "#fbbf24", // amber-400
        marker: "#a5b4fc", // indigo-300
        today: "#f87171", // red-400
        summer: "#4ade80",
        ramazan: "#c084fc",
        tooltipBg: "#18181b",
        tooltipBorder: "#3f3f46",
        tooltipLabel: "#fafafa",
        textPrimary: "#fafafa",
        textMuted: "#a1a1aa",
        cursor: "rgba(129,140,248,0.18)",
      }
    : {
        grid: "#e7e5e4",
        axis: "#d6d3d1",
        axisTick: "#78716c",
        yTick: "#a8a29e",
        primary: "#6366f1",
        primaryFill: "url(#cal-gradient-buyil)",
        prev: "#d97706",
        marker: "#4338ca",
        today: "#dc2626",
        summer: "#16a34a",
        ramazan: "#9333ea",
        tooltipBg: "#ffffff",
        tooltipBorder: "#d6d3d1",
        tooltipLabel: "#1c1917",
        textPrimary: "#44403c",
        textMuted: "#a8a29e",
        cursor: "rgba(99,102,241,0.2)",
      };
}

export function CalendarChart({ monthly, unit = "tl" }: Props) {
  const unitSuffix = unit === "9le" ? "9L" : "₺";
  const [colors, setColors] = useState(readChartColors);
  useEffect(() => {
    const onChange = () => setColors(readChartColors());
    window.addEventListener("enroute:theme:changed", onChange);
    return () => window.removeEventListener("enroute:theme:changed", onChange);
  }, []);

  const { data, max, todayIdx, summerRange, ramazanRange, markers } = useMemo(() => {
    const series = monthly.length > 12 ? monthly.slice(-12) : monthly;
    const enriched = series.map((m, i) => {
      const [, mo] = m.yyyymm.split("-");
      const monthNum = Number(mo);
      return {
        ...m,
        idx: i,
        monthNum,
        // Recharts'a hem ciro hem ciroPrev'i flat veriyoruz; null'lar legend'ı
        // bozmasın diye undefined'a düşürüyoruz (Recharts undefined'ı atlar).
        _isSummerLocal: m.isSummer ?? (monthNum >= 6 && monthNum <= 9),
      };
    });

    // ortak max — y skalası
    let max = 1;
    for (const m of enriched) {
      if (m.ciro > max) max = m.ciro;
      if (m.ciroPrev != null && m.ciroPrev > max) max = m.ciroPrev;
    }

    const todayIdx = enriched.findIndex((m) => m.isCurrent);

    // Yaz (peş peşe summer ay'ları) → ReferenceArea aralığı
    const summers = enriched.filter((m) => m._isSummerLocal);
    const summerRange =
      summers.length > 1
        ? {
            start: summers[0]?.ay ?? null,
            end: summers[summers.length - 1]?.ay ?? null,
          }
        : null;

    // Ramazan (peş peşe ramazan ay'ları)
    const ramazans = enriched.filter((m) => m.isRamazan);
    const ramazanRange =
      ramazans.length > 0
        ? {
            start: ramazans[0]?.ay ?? null,
            end: ramazans[ramazans.length - 1]?.ay ?? null,
          }
        : null;

    // Bayram/tatil dot işaretçileri
    const markers = enriched
      .map((m) => {
        if (m.monthNum === 1) return { ay: m.ay, label: "Yılbaşı", ciro: m.ciro };
        if (m.monthNum === 2) return { ay: m.ay, label: "14 Şub", ciro: m.ciro };
        if (m.monthNum === 10) return { ay: m.ay, label: "29 Ekim", ciro: m.ciro };
        return null;
      })
      .filter((x): x is { ay: string; label: string; ciro: number } => x !== null);

    // Recharts data — basit shape, key'ler ay etiketi
    const data = enriched.map((m) => ({
      ay: m.ay,
      yyyymm: m.yyyymm,
      ciro: m.ciro,
      ciroPrev: m.ciroPrev ?? null,
      isCurrent: m.isCurrent,
    }));

    return { data, max, todayIdx, summerRange, ramazanRange, markers };
  }, [monthly]);

  if (data.length < 2) return null;

  const todayPoint =
    todayIdx >= 0 && todayIdx < data.length
      ? data[todayIdx]
      : data[data.length - 1];

  return (
    <>
      <div className="section-eyebrow">Takvim · Bu Yıl vs Geçen Yıl Hizalı</div>
      <div className="cal-chart-card">
        <div className="cal-chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 28, right: 20, left: 4, bottom: 4 }}
            >
              <defs>
                <linearGradient id="cal-gradient-buyil" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.primary} stopOpacity={0.32} />
                  <stop offset="95%" stopColor={colors.primary} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="ay"
                tick={{ fill: colors.axisTick, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: colors.axis }}
              />
              <YAxis
                tickFormatter={formatCompact}
                tick={{ fill: colors.yTick, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={56}
                domain={[0, max * 1.1]}
              />

              {/* Yaz band — yumuşak yeşil */}
              {summerRange && summerRange.start && summerRange.end && (
                <ReferenceArea
                  x1={summerRange.start}
                  x2={summerRange.end}
                  fill={colors.summer}
                  fillOpacity={0.06}
                  ifOverflow="visible"
                  label={{
                    value: "Yaz Pik",
                    position: "insideTop",
                    fill: colors.summer,
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
              )}

              {/* Ramazan band — vurgulu mor */}
              {ramazanRange && ramazanRange.start && ramazanRange.end && (
                <ReferenceArea
                  x1={ramazanRange.start}
                  x2={ramazanRange.end}
                  fill={colors.ramazan}
                  fillOpacity={0.1}
                  label={{
                    value: "Ramazan",
                    position: "insideTop",
                    fill: colors.ramazan,
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
              )}

              {/* Geçen Yıl — dotted line, gri-amber */}
              <Line
                type="monotone"
                dataKey="ciroPrev"
                stroke={colors.prev}
                strokeWidth={1.8}
                strokeDasharray="6 4"
                dot={false}
                activeDot={{ r: 4, fill: colors.prev, stroke: colors.tooltipBg, strokeWidth: 2 }}
                connectNulls
                name="Geçen Yıl"
                isAnimationActive={false}
              />

              {/* Bu Yıl — solid + area */}
              <Area
                type="monotone"
                dataKey="ciro"
                stroke={colors.primary}
                strokeWidth={2.5}
                fill={colors.primaryFill}
                dot={{ r: 3, fill: colors.primary, stroke: colors.tooltipBg, strokeWidth: 1.5 }}
                activeDot={{ r: 5, fill: colors.primary, stroke: colors.tooltipBg, strokeWidth: 2 }}
                name="Bu Yıl"
                isAnimationActive={false}
              />

              {/* Bayram/Tatil noktaları */}
              {markers.map((mk, i) => (
                <ReferenceDot
                  key={`mk-${i}-${mk.label}`}
                  x={mk.ay}
                  y={mk.ciro}
                  r={4}
                  fill={colors.marker}
                  stroke={colors.tooltipBg}
                  strokeWidth={1.5}
                  label={{
                    value: mk.label,
                    position: "top",
                    fill: colors.textPrimary,
                    fontSize: 9,
                    fontWeight: 500,
                  }}
                  ifOverflow="visible"
                />
              ))}

              {/* Bugün — kırmızı vurgu noktası */}
              {todayPoint && (
                <ReferenceDot
                  x={todayPoint.ay}
                  y={todayPoint.ciro}
                  r={6}
                  fill={colors.today}
                  stroke={colors.tooltipBg}
                  strokeWidth={2}
                  ifOverflow="visible"
                  label={{
                    value: "Bugün",
                    position: "top",
                    fill: colors.today,
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                />
              )}

              <Tooltip
                cursor={{ stroke: colors.primary, strokeOpacity: 0.2, strokeWidth: 24 }}
                contentStyle={{
                  background: colors.tooltipBg,
                  border: `1px solid ${colors.tooltipBorder}`,
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: "Inter, system-ui",
                  padding: "8px 10px",
                }}
                labelStyle={{ color: colors.tooltipLabel, fontWeight: 700, marginBottom: 4 }}
                formatter={(v, name) => {
                  if (v === null || v === undefined) return ["—", String(name ?? "")];
                  const num = typeof v === "number" ? v : Number(v);
                  return [`${formatCompact(num)} ${unitSuffix}`, String(name ?? "")];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                iconType="circle"
                iconSize={8}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="cal-hint">
          Son 12 ay vs 12-ay-önceki aynı pencere. Kaynak: TBLMSDFATURA SUM(DBLNETTUTAR),
          BYTTUR=0 AND BYTDURUM=0. Ramazan/Yaz bantları takvim master'dan; Bugün
          son senkron tarihindeki ay.
        </div>
      </div>

      <style jsx>{`
        .cal-chart-card {
          background: linear-gradient(180deg, var(--color-surface) 0%, var(--color-surface-2) 100%);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 14px 16px 10px 16px;
          margin-bottom: 16px;
        }
        .cal-chart-wrap {
          width: 100%;
          height: 300px;
        }
        .cal-hint {
          margin-top: 4px;
          font-size: 10.5px;
          color: var(--color-muted-2);
          line-height: 1.45;
        }
      `}</style>
    </>
  );
}

function formatCompact(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000_000)
    return (n / 1_000_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mr";
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + " Mn";
  if (Math.abs(n) >= 1_000)
    return (n / 1_000).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " B";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}
