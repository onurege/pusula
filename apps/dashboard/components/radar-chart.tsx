"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = Record<string, unknown>;

type ChartSpec =
  | { kind: "bar"; xKey: string; yKey: string; orientation?: "vertical" | "horizontal" }
  | { kind: "line"; xKey: string; yKey: string }
  | { kind: "pie"; nameKey: string; valueKey: string };

// Tailwind hex equivalents — recharts paint props don't read CSS variables
// so these are pinned to match @theme tokens (light + indigo from
// globals.css). Update both places together.
const ACCENT = "#6366f1"; // indigo-500
const GRID_STROKE = "#e4e4e7"; // zinc-200
const AXIS_STROKE = "#71717a"; // zinc-500
const TOOLTIP_BG = "#ffffff";
const TOOLTIP_BORDER = "#e4e4e7";
const TOOLTIP_TEXT = "#18181b";
const PIE_COLORS = [
  "#6366f1", // indigo-500
  "#0ea5e9", // sky-500
  "#16a34a", // green-600
  "#f97316", // orange-500
  "#a855f7", // violet-500
  "#eab308", // yellow-500
];

function formatTick(v: unknown): string {
  if (typeof v === "number") {
    if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
    if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + "k";
    return String(v);
  }
  if (v instanceof Date) return new Date(v).toLocaleDateString("tr-TR");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    return new Date(v).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
  }
  return String(v ?? "");
}

function tooltipFmt(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("tr-TR");
  return String(v ?? "");
}

export function RadarChart({ spec, rows }: { spec: ChartSpec; rows: Row[] }) {
  if (!rows || rows.length === 0) {
    return <div className="text-muted text-sm h-72 flex items-center justify-center">Veri yok.</div>;
  }

  // Coerce numeric strings to numbers so the chart axes scale properly.
  const data = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const num = typeof v === "string" && v !== "" && !isNaN(Number(v)) ? Number(v) : v;
      out[k] = num;
    }
    return out;
  });

  if (spec.kind === "bar") {
    const horizontal = spec.orientation === "horizontal";
    // Horizontal charts need taller height when there are many categories so
    // recharts doesn't skip labels. ~32px per bar is comfortable.
    const containerHeight = horizontal
      ? Math.max(320, data.length * 32 + 40)
      : 320;
    return (
      <div className="w-full" style={{ height: containerHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
          >
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
            {horizontal ? (
              <>
                <XAxis type="number" stroke={AXIS_STROKE} tickFormatter={formatTick} />
                {/* interval={0} forces every label to render — without it
                    recharts auto-skips when the next tick would overlap. */}
                <YAxis
                  dataKey={spec.xKey}
                  type="category"
                  stroke={AXIS_STROKE}
                  width={140}
                  interval={0}
                  tick={{ fontSize: 11 }}
                />
              </>
            ) : (
              <>
                <XAxis dataKey={spec.xKey} stroke={AXIS_STROKE} tickFormatter={formatTick} />
                <YAxis stroke={AXIS_STROKE} tickFormatter={formatTick} />
              </>
            )}
            <Tooltip
              contentStyle={{
                background: TOOLTIP_BG,
                border: `1px solid ${TOOLTIP_BORDER}`,
                borderRadius: 8,
                color: TOOLTIP_TEXT,
              }}
              formatter={(value) => tooltipFmt(value)}
            />
            <Bar dataKey={spec.yKey} fill={ACCENT} radius={4} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.kind === "line") {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
            <XAxis dataKey={spec.xKey} stroke={AXIS_STROKE} tickFormatter={formatTick} />
            <YAxis stroke={AXIS_STROKE} tickFormatter={formatTick} />
            <Tooltip
              contentStyle={{
                background: TOOLTIP_BG,
                border: `1px solid ${TOOLTIP_BORDER}`,
                borderRadius: 8,
                color: TOOLTIP_TEXT,
              }}
              formatter={(value) => tooltipFmt(value)}
            />
            <Line
              type="monotone"
              dataKey={spec.yKey}
              stroke={ACCENT}
              strokeWidth={2}
              dot={{ r: 3, fill: ACCENT }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.kind === "pie") {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey={spec.valueKey}
              nameKey={spec.nameKey}
              outerRadius={100}
              innerRadius={60}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: TOOLTIP_BG,
                border: `1px solid ${TOOLTIP_BORDER}`,
                borderRadius: 8,
                color: TOOLTIP_TEXT,
              }}
              formatter={(value) => tooltipFmt(value)}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return null;
}
