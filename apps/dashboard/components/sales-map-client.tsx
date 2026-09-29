"use client";

import dynamic from "next/dynamic";
import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/i18n";

function MapLoading() {
  const { locale } = useLocale();
  return (
    <div className="w-full h-full flex items-center justify-center text-muted text-sm">
      {t(locale, "map.loading", "Harita yükleniyor…")}
    </div>
  );
}

// maplibre-gl uses window globals, must run client-only.
export const SalesMap = dynamic(
  () => import("./sales-map").then((m) => m.default),
  {
    ssr: false,
    loading: MapLoading,
  },
);
