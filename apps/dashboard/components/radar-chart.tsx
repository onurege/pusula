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

const ACCENT = "oklch(0.78 0.16 60)";
const PIE_COLORS = [
  "oklch(0.78 0.16 60)",
  "oklch(0.72 0.15 200)",
  "oklch(0.78 0.18 145)",
  "oklch(0.65 0.22 25)",
  "oklch(0.70 0.16 290)",
  "oklch(0.75 0.13 100)",
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
    return (
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: 8, right: 12, bottom: 8, left: horizontal ? 80 : 0 }}
          >
            <CartesianGrid stroke="oklch(0.30 0 0)" strokeDasharray="3 3" />
            {horizontal ? (
              <>
                <XAxis type="number" stroke="oklch(0.65 0 0)" tickFormatter={formatTick} />
                <YAxis dataKey={spec.xKey} type="category" stroke="oklch(0.65 0 0)" width={120} />
              </>
            ) : (
              <>
                <XAxis dataKey={spec.xKey} stroke="oklch(0.65 0 0)" tickFormatter={formatTick} />
                <YAxis stroke="oklch(0.65 0 0)" tickFormatter={formatTick} />
              </>
            )}
            <Tooltip
              contentStyle={{
                background: "oklch(0.18 0 0)",
                border: "1px solid oklch(0.30 0 0)",
                borderRadius: 8,
                color: "oklch(0.96 0 0)",
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
            <CartesianGrid stroke="oklch(0.30 0 0)" strokeDasharray="3 3" />
            <XAxis dataKey={spec.xKey} stroke="oklch(0.65 0 0)" tickFormatter={formatTick} />
            <YAxis stroke="oklch(0.65 0 0)" tickFormatter={formatTick} />
            <Tooltip
              contentStyle={{
                background: "oklch(0.18 0 0)",
                border: "1px solid oklch(0.30 0 0)",
                borderRadius: 8,
                color: "oklch(0.96 0 0)",
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
                background: "oklch(0.18 0 0)",
                border: "1px solid oklch(0.30 0 0)",
                borderRadius: 8,
                color: "oklch(0.96 0 0)",
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
