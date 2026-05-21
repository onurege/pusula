"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { KomutaChannelMonthlyRow, ValueUnit } from "@/lib/api";

type Props = {
  rows: KomutaChannelMonthlyRow[];
  /** Birim — değerler TL veya 9LE bazında olur. Default: tl. */
  unit?: ValueUnit;
  /** Default: "Kanal Mix · Son 12 Ay" */
  title?: string;
  /** Default: "📊" */
  icon?: string;
  /** Empty-state ve hint metni için kategori adı (örn. "kanal mix", "müşteri tipi") */
  category?: string;
  /** Hint footer'da gösterilen kaynak açıklaması */
  sourceNote?: string;
};

// Tutarlı kanal renkleri — Komuta'nın geri kalanıyla aynı palette.
// 7 renk: 6 top kanal + "Diğer" fallback. Tema değişimine duyarlı:
// dark mode'da daha aydınlık tonlar.
const CHANNEL_COLORS_LIGHT = [
  "#6366f1", "#16a34a", "#d97706", "#0891b2", "#9333ea", "#dc2626", "#94a3b8",
];
const CHANNEL_COLORS_DARK = [
  "#818cf8", "#4ade80", "#fbbf24", "#22d3ee", "#c084fc", "#f87171", "#a1a1aa",
];

function readChartColors() {
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark";
  return isDark
    ? {
        channels: CHANNEL_COLORS_DARK,
        grid: "#27272a",
        axis: "#3f3f46",
        axisTick: "#a1a1aa",
        yTick: "#71717a",
        tooltipBg: "#18181b",
        tooltipBorder: "#3f3f46",
        tooltipLabel: "#fafafa",
        cursor: "rgba(129,140,248,0.10)",
      }
    : {
        channels: CHANNEL_COLORS_LIGHT,
        grid: "#e7e5e4",
        axis: "#d6d3d1",
        axisTick: "#78716c",
        yTick: "#a8a29e",
        tooltipBg: "#ffffff",
        tooltipBorder: "#d6d3d1",
        tooltipLabel: "#1c1917",
        cursor: "rgba(99,102,241,0.06)",
      };
}

/**
 * Son 12 ay × kanal stacked bar chart. Recharts ResponsiveContainer ile
 * ebeveyninin tüm genişliğini kullanır. Backend `KomutaChannelMonthlyRow[]`
 * formatında flat satırlar gönderir; burada {ay, [kanal]: ciro} pivot edilir.
 */
export function ChannelMixChart({
  rows,
  unit = "tl",
  title = "Kanal Mix · Son 12 Ay",
  icon = "📊",
  category = "kanal mix",
  sourceNote = "Müşteri grubu (TBLMUSTERIGRUP.TXTAD) × ay kırılımı, son 12 ay. Top 5 kanal görünür; geri kalan \"Diğer\" altında toplandı.",
}: Props) {
  const unitSuffix = unit === "9le" ? "9L" : "₺";
  const [colors, setColors] = useState(readChartColors);
  useEffect(() => {
    const onChange = () => setColors(readChartColors());
    window.addEventListener("enroute:theme:changed", onChange);
    return () => window.removeEventListener("enroute:theme:changed", onChange);
  }, []);
  const { data, channels, totals } = useMemo(() => {
    // Defensive: eski cache'lenmiş snapshot'lar `channelMonthly` alanı
    // olmadan dönüyor olabilir. Array değilse boş kabul et — UI bozulmasın,
    // "Verileri yenile" sonrası dolu gelecek.
    const safeRows = Array.isArray(rows) ? rows : [];

    // Ay sırasını koru — backend `ORDER BY yil, ay` yapar; biz set kullanarak
    // ilk-görüş sırasını yakalıyoruz.
    const monthOrder: string[] = [];
    const monthLabel = new Map<string, string>();
    const byMonth = new Map<string, Record<string, number>>();
    const channelSet = new Set<string>();
    let grandTotal = 0;

    for (const row of safeRows) {
      if (!monthOrder.includes(row.yyyymm)) {
        monthOrder.push(row.yyyymm);
        monthLabel.set(row.yyyymm, row.ay);
      }
      const cur = byMonth.get(row.yyyymm) ?? {};
      cur[row.kanal] = (cur[row.kanal] ?? 0) + row.ciro;
      byMonth.set(row.yyyymm, cur);
      channelSet.add(row.kanal);
      grandTotal += row.ciro;
    }

    // Kanal sırası — toplam katkıya göre büyükten küçüğe; "Diğer" en alta
    const channelTotals = new Map<string, number>();
    for (const ch of channelSet) {
      let t = 0;
      for (const m of monthOrder) t += byMonth.get(m)?.[ch] ?? 0;
      channelTotals.set(ch, t);
    }
    const channels = [...channelSet].sort((a, b) => {
      if (a === "Diğer") return 1;
      if (b === "Diğer") return -1;
      return (channelTotals.get(b) ?? 0) - (channelTotals.get(a) ?? 0);
    });

    // Flat data: { yyyymm, ay, [channel]: ciro, ... }
    const data = monthOrder.map((m) => {
      const cells = byMonth.get(m) ?? {};
      const row: Record<string, string | number> = {
        yyyymm: m,
        ay: monthLabel.get(m) ?? m,
      };
      for (const ch of channels) row[ch] = cells[ch] ?? 0;
      return row;
    });

    return { data, channels, totals: { grandTotal } };
  }, [rows]);

  if (data.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">
            <span className="icon">{icon}</span> {title}
          </div>
        </div>
        <div className="cmc-empty">
          {category} verisi henüz hazır değil. Sağ üstteki <strong>Verileri
          yenile</strong> butonuna tıklayarak son 12 ayın aylık kırılımını çek.
        </div>
        <style jsx>{`
          .cmc-empty {
            padding: 20px 16px;
            color: var(--color-muted);
            font-size: 12px;
            line-height: 1.5;
            border: 1px dashed var(--color-border-strong);
            border-radius: 8px;
            background: var(--color-surface-2);
          }
          .cmc-empty strong {
            color: var(--color-fg);
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">{icon}</span> {title}
        </div>
        <div className="panel-meta">{formatCompact(totals.grandTotal)} {unitSuffix} toplam</div>
      </div>

      <div className="cmc-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 16, left: 4, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="ay"
              tick={{ fill: colors.axisTick, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colors.axis }}
            />
            <YAxis
              tickFormatter={formatCompact}
              tick={{ fill: colors.axisTick, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={60}
            />
            <Tooltip
              cursor={{ fill: colors.cursor }}
              formatter={(v, name) => {
                const num = typeof v === "number" ? v : Number(v ?? 0);
                return [`${formatCompact(num)} ${unitSuffix}`, String(name ?? "")];
              }}
              contentStyle={{
                background: colors.tooltipBg,
                border: `1px solid ${colors.tooltipBorder}`,
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "Inter, system-ui",
              }}
              labelStyle={{ color: colors.tooltipLabel, fontWeight: 600 }}
              itemStyle={{ padding: "1px 0" }}
              labelFormatter={(label) => `${String(label ?? "")} · Aylık Toplam`}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
              iconType="circle"
              iconSize={8}
            />
            {channels.map((ch, i) => (
              <Bar
                key={ch}
                dataKey={ch}
                stackId="cmix"
                fill={colors.channels[i % colors.channels.length]}
                // En üstteki bar'a hafif radius (ay'ın en üstündeki segment)
                radius={i === channels.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={42}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="cmc-hint">{sourceNote}</div>

      <style jsx>{`
        .cmc-chart-wrap {
          width: 100%;
          height: 280px;
        }
        .cmc-hint {
          margin-top: 8px;
          font-size: 10.5px;
          color: var(--color-muted-2);
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}

/** Komuta page'deki formatCompact ile aynı davranış — sadece bu component
 *  için yerel kopya (page tsx'ten import problematik server/client sınırı). */
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
