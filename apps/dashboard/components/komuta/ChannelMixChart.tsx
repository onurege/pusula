"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { KomutaChannelMonthlyRow, ValueUnit } from "@/lib/api";

type ViewMode = "bar" | "pie";
type PeriodOption = 3 | 6 | 12;

type Props = {
  rows: KomutaChannelMonthlyRow[];
  /** Birim — değerler TL veya 9LE bazında olur. Default: tl. */
  unit?: ValueUnit;
  /** Default: "Kanal Mix" */
  title?: string;
  /** Default: "📊" */
  icon?: string;
  /** Empty-state ve hint metni için kategori adı (örn. "kanal mix", "müşteri tipi") */
  category?: string;
  /** Hint footer'da gösterilen kaynak açıklaması */
  sourceNote?: string;
  /** md14: dönem filtresi (3/6/12 ay) segment kontrolü göster. Default: false. */
  enablePeriodFilter?: boolean;
  /** md14: Bar ↔ Pasta görünüm toggle'ı göster. Default: false. */
  enablePieView?: boolean;
  /** md15: müşteri tipi (kanal) filtre dropdown'u göster — ek gruptan gelen
   *  kırılımı tek bir kanala daraltmak için. Default: false. */
  enableTypeFilter?: boolean;
  /** md15: dropdown etiketi. Default: "Müşteri Tipi" */
  typeFilterLabel?: string;
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
 * Ay × kanal stacked bar chart (+ isteğe bağlı pasta görünümü). Recharts
 * ResponsiveContainer ile ebeveyninin tüm genişliğini kullanır. Backend
 * `KomutaChannelMonthlyRow[]` formatında flat satırlar gönderir (son 12 ay,
 * sabit pencere — yeni SQL/param yok); dönem/tip filtreleri VE bar↔pasta
 * görünüm geçişi tamamen client-side, zaten çekilmiş veri üzerinde çalışır.
 */
export function ChannelMixChart({
  rows,
  unit = "tl",
  title = "Kanal Mix",
  icon = "📊",
  category = "kanal mix",
  sourceNote = "Müşteri grubu (TBLMUSTERIGRUP.TXTAD) × ay kırılımı, son 12 ay. Top 5 kanal görünür; geri kalan \"Diğer\" altında toplandı.",
  enablePeriodFilter = false,
  enablePieView = false,
  enableTypeFilter = false,
  typeFilterLabel = "Müşteri Tipi",
}: Props) {
  const unitSuffix = unit === "9le" ? "9L" : "₺";
  const [colors, setColors] = useState(readChartColors);
  const [view, setView] = useState<ViewMode>("bar");
  const [periodMonths, setPeriodMonths] = useState<PeriodOption>(12);
  const [selectedType, setSelectedType] = useState<string>("all");
  useEffect(() => {
    const onChange = () => setColors(readChartColors());
    window.addEventListener("enroute:theme:changed", onChange);
    return () => window.removeEventListener("enroute:theme:changed", onChange);
  }, []);

  const safeRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows]);

  // md15: dropdown seçenekleri — TÜM (filtresiz) satırlardaki distinct kanal
  // adları, katkıya göre büyükten küçüğe (ek gruptan gelen müşteri tipi listesi).
  const typeOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of safeRows) totals.set(r.kanal, (totals.get(r.kanal) ?? 0) + r.ciro);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([kanal]) => kanal);
  }, [safeRows]);

  // md14/md15: dönem + tip filtresi — ikisi de zaten çekilmiş `rows` üzerinde,
  // client-side. Yeni fetch/SQL yok.
  const filteredRows = useMemo(() => {
    let r = safeRows;
    if (enableTypeFilter && selectedType !== "all") {
      r = r.filter((row) => row.kanal === selectedType);
    }
    if (enablePeriodFilter && periodMonths < 12) {
      const months = [...new Set(r.map((row) => row.yyyymm))].sort();
      const lastN = new Set(months.slice(-periodMonths));
      r = r.filter((row) => lastN.has(row.yyyymm));
    }
    return r;
  }, [safeRows, enableTypeFilter, selectedType, enablePeriodFilter, periodMonths]);

  const { data, channels, totals, pieData } = useMemo(() => {
    // Ay sırasını koru — backend `ORDER BY yil, ay` yapar; biz set kullanarak
    // ilk-görüş sırasını yakalıyoruz.
    const monthOrder: string[] = [];
    const monthLabel = new Map<string, string>();
    const byMonth = new Map<string, Record<string, number>>();
    const channelSet = new Set<string>();
    let grandTotal = 0;

    for (const row of filteredRows) {
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

    // md14: pasta görünümü — seçili dönem için kanal başına toplam pay.
    const pieData = channels.map((ch) => ({ name: ch, value: channelTotals.get(ch) ?? 0 }));

    return { data, channels, totals: { grandTotal }, pieData };
  }, [filteredRows]);

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

  const showToolbar = enablePeriodFilter || enablePieView || enableTypeFilter;

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">{icon}</span> {title}
        </div>
        <div className="panel-meta">{formatCompact(totals.grandTotal)} {unitSuffix} toplam</div>
      </div>

      {showToolbar && (
        <div className="cmc-toolbar">
          {enableTypeFilter && (
            <label className="cmc-select-wrap">
              <span className="cmc-select-label">{typeFilterLabel}</span>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                aria-label={typeFilterLabel}
              >
                <option value="all">Tümü</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          )}
          {enablePeriodFilter && (
            <div className="cmc-seg" role="tablist" aria-label="Dönem">
              {([3, 6, 12] as PeriodOption[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={periodMonths === m}
                  className={periodMonths === m ? "on" : ""}
                  onClick={() => setPeriodMonths(m)}
                >
                  {m} Ay
                </button>
              ))}
            </div>
          )}
          {enablePieView && (
            <div className="cmc-seg" role="tablist" aria-label="Görünüm">
              <button
                type="button"
                role="tab"
                aria-selected={view === "bar"}
                className={view === "bar" ? "on" : ""}
                onClick={() => setView("bar")}
              >
                Bar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "pie"}
                className={view === "pie" ? "on" : ""}
                onClick={() => setView("pie")}
              >
                Pasta
              </button>
            </div>
          )}
        </div>
      )}

      <div className="cmc-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          {view === "pie" ? (
            <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <Tooltip
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
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" iconSize={8} />
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius="45%"
                outerRadius="80%"
                paddingAngle={1.5}
                strokeWidth={1}
              >
                {pieData.map((entry, i) => (
                  <Cell key={entry.name} fill={colors.channels[i % colors.channels.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
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
          )}
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
        .cmc-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-top: 4px;
        }
        .cmc-select-wrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--color-muted);
        }
        .cmc-select-wrap select {
          font-size: 11.5px;
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid var(--color-border);
          background: var(--color-surface-2);
          color: var(--color-fg);
        }
        .cmc-seg {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 2px;
          border-radius: 8px;
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
        }
        .cmc-seg button {
          appearance: none;
          border: none;
          background: transparent;
          color: var(--color-muted);
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
            color 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .cmc-seg button.on {
          background: var(--color-surface);
          color: var(--color-fg);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        .cmc-seg button:hover:not(.on) {
          color: var(--color-fg);
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
