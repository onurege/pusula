"use client";

import dynamic from "next/dynamic";

// recharts ResponsiveContainer can't measure during SSR; defer to client.
export const RadarChart = dynamic(
  () => import("./radar-chart").then((m) => m.RadarChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 w-full text-muted text-sm flex items-center justify-center">
        Grafik yükleniyor…
      </div>
    ),
  },
);
