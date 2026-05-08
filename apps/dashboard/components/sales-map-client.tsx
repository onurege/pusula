"use client";

import dynamic from "next/dynamic";

// maplibre-gl uses window globals, must run client-only.
export const SalesMap = dynamic(
  () => import("./sales-map").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center text-muted text-sm">
        Harita yükleniyor…
      </div>
    ),
  },
);
