"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTenant } from "@/components/tenant-provider";

/**
 * md21 — Satış Performansı birim toggle'ı: TL ↔ hacim (tenant.volume).
 *
 * Genel Komuta `UnitToggle`'ından (`components/komuta/UnitToggle.tsx`) farkı:
 * o bileşen `tenant.volume.showInToggle` bayrağına bağlı (Wietnauer'da hâlâ
 * kapalı — global birim-toggle omurgası Faz 2'de açılacak) ve
 * `getKomutaSnapshot({ unit })` ile TÜM aggregation'ı sunucuda birim
 * bazında yeniden hesaplıyor. Satış Performansı snapshot'ı zaten hem ciro
 * (TL) hem hacim (70cl eşdeğer) alanlarını BİRLİKTE taşıdığı için burada
 * yalnızca EKRAN düzeyinde bir görünüm anahtarı yeterli — sunucuya ek
 * sorgu gitmez, `?unit=` sadece hangi alanın öne çıkarılacağını belirler.
 * Bu yüzden global bayrağı beklemeden, yalnızca bu sayfada devreye
 * alınmıştır (görev talebi: "TL↔Hacim toggle yoksa ekle").
 */
export function SatisUnitToggle() {
  const pathname = usePathname() ?? "/";
  const sp = useSearchParams();
  const tenant = useTenant();

  const volumeKey = tenant.volume.key;
  const active = sp.get("unit") === volumeKey ? volumeKey : "tl";

  function buildHref(unit: "tl" | typeof volumeKey): string {
    const params = new URLSearchParams(sp.toString());
    if (unit === "tl") params.delete("unit");
    else params.set("unit", unit);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const options: { id: "tl" | typeof volumeKey; label: string; hint: string }[] = [
    {
      id: "tl",
      label: `${tenant.currencySymbol} TL`,
      hint: "Ciro (net tutar) bazlı görünüm",
    },
    {
      id: volumeKey,
      label: tenant.volume.short,
      hint: tenant.volume.hint,
    },
  ];

  return (
    <div
      role="tablist"
      aria-label="Birim"
      className="satis-unit-toggle"
      title={`TL ↔ ${tenant.volume.short} görünüm anahtarı — sunucu sorgusu değişmez, yalnızca gösterim.`}
    >
      <span className="lbl">Birim</span>
      {options.map((opt) => {
        const isActive = active === opt.id;
        return (
          <Link
            key={opt.id}
            href={buildHref(opt.id)}
            role="tab"
            aria-selected={isActive}
            title={opt.hint}
            className={`opt${isActive ? " active" : ""}`}
          >
            {opt.label}
          </Link>
        );
      })}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .satis-unit-toggle {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 4px;
          border-radius: 8px;
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
        }
        .satis-unit-toggle .lbl {
          padding: 0 8px;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-muted);
          font-weight: 600;
        }
        .satis-unit-toggle .opt {
          display: inline-flex; align-items: center;
          height: 28px; padding: 0 12px;
          border-radius: 6px;
          font-size: 12px; font-weight: 600;
          color: var(--color-muted);
          text-decoration: none;
          transition: background-color 0.15s ease, color 0.15s ease;
        }
        .satis-unit-toggle .opt:hover { color: var(--color-fg); }
        .satis-unit-toggle .opt.active {
          background: var(--color-surface);
          color: var(--color-fg);
          border: 1px solid var(--color-border);
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
      `,
        }}
      />
    </div>
  );
}
