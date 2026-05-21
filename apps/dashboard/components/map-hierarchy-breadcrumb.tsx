"use client";

import Link from "next/link";
import { ChevronRight, Globe2, Layers, MapPin, Store } from "lucide-react";
import { useMemo } from "react";

type Props = {
  // URL durumundan gelen filtreler — her biri opsiyonel
  viewMode: "customer" | "region";
  region?: string | null; // klasik bölge: Marmara/Ege/...
  sehir?: string | null;
  bolge?: string | null; // legacy TBLDISTGRUP
  distKod?: number | null;
  distributorName?: string | null; // distKod'dan resolve edilirse görünür
  // Seçili seviyenin müşteri sayısı (üst düzey state'ten gelir)
  customerCount?: number;
};

/**
 * Map sayfasında hiyerarşik drill-down rotasını üst header'da gösterir:
 *
 *   Türkiye  ›  Akdeniz  ›  ANTALYA  ›  BH ANTALYA  ›  ...
 *
 * Her halka tıklanabilir → o seviyeye geri döner (üst seviye filtreleri korur,
 * alt seviyeyi temizler). En son halka mevcut konumdur (link yok).
 */
export function MapHierarchyBreadcrumb({
  viewMode,
  region,
  sehir,
  bolge,
  distKod,
  distributorName,
  customerCount,
}: Props) {
  const levels = useMemo(() => {
    const items: Array<{
      label: string;
      icon: React.ReactNode;
      href: string | null;
      muted?: boolean;
    }> = [
      {
        label: "Türkiye",
        icon: <Globe2 size={11} />,
        href: viewMode === "region" || region || sehir || bolge || distKod ? "/map" : null,
      },
    ];

    if (viewMode === "region" && !region && !sehir && !bolge) {
      items.push({
        label: "Bölge görünümü",
        icon: <Layers size={11} />,
        href: null,
      });
    }

    if (region) {
      const isLeaf = !sehir && !bolge && !distKod;
      const params = new URLSearchParams();
      params.set("region", region);
      items.push({
        label: region,
        icon: <Layers size={11} />,
        href: isLeaf ? null : `/map?${params.toString()}`,
      });
    }

    if (bolge) {
      const isLeaf = !sehir && !distKod;
      const params = new URLSearchParams();
      params.set("bolge", bolge);
      if (region) params.set("region", region);
      items.push({
        label: bolge,
        icon: <Layers size={11} />,
        href: isLeaf ? null : `/map?${params.toString()}`,
      });
    }

    if (sehir) {
      const isLeaf = !distKod;
      const params = new URLSearchParams();
      params.set("sehir", sehir);
      if (region) params.set("region", region);
      if (bolge) params.set("bolge", bolge);
      items.push({
        label: sehir,
        icon: <MapPin size={11} />,
        href: isLeaf ? null : `/map?${params.toString()}`,
      });
    }

    if (distKod) {
      items.push({
        label: distributorName ?? `Dist #${distKod}`,
        icon: <Store size={11} />,
        href: null,
      });
    }

    return items;
  }, [viewMode, region, sehir, bolge, distKod, distributorName]);

  return (
    <div className="mhb-wrap">
      <ol className="mhb-list">
        {levels.map((lvl, i) => (
          <li key={i} className="mhb-item">
            {lvl.href ? (
              <Link href={lvl.href} className="mhb-link">
                <span className="mhb-icon">{lvl.icon}</span>
                <span className="mhb-label">{lvl.label}</span>
              </Link>
            ) : (
              <span className="mhb-current">
                <span className="mhb-icon">{lvl.icon}</span>
                <span className="mhb-label">{lvl.label}</span>
              </span>
            )}
            {i < levels.length - 1 && (
              <ChevronRight size={11} className="mhb-sep" aria-hidden />
            )}
          </li>
        ))}
      </ol>
      {typeof customerCount === "number" && (
        <span className="mhb-count">
          {customerCount.toLocaleString("tr-TR")} müşteri
        </span>
      )}

      <style jsx>{`
        .mhb-wrap {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-size: 11.5px;
          min-width: 0;
        }
        .mhb-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: nowrap;
          overflow: hidden;
        }
        .mhb-item {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: var(--color-muted);
          min-width: 0;
        }
        .mhb-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--color-fg-2);
          text-decoration: none;
          transition: background 0.12s, color 0.12s;
        }
        .mhb-link:hover {
          background: var(--color-surface-2);
          color: var(--color-accent);
        }
        .mhb-current {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--color-accent-soft);
          color: var(--color-accent);
          font-weight: 600;
          max-width: 220px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mhb-icon {
          display: inline-flex;
          opacity: 0.65;
        }
        .mhb-current .mhb-icon { opacity: 1; }
        .mhb-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mhb-sep {
          color: var(--color-muted-2);
          flex-shrink: 0;
        }
        .mhb-count {
          font-size: 10.5px;
          color: var(--color-muted);
          background: var(--color-surface-2);
          padding: 2px 8px;
          border-radius: 999px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}
