"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Map as MapIcon, Layers } from "lucide-react";
import { cn } from "@/components/ui/cn";

type Props = {
  current: "customer" | "region" | "city";
};

/**
 * Müşteri (varsayılan) vs Bölge bazlı görünüm toggle'ı. URL'deki ?view=
 * parametresini kontrol eder. Region moduna geçince ?bolge= filter'ı
 * temizlenir (drill-down sıfırlansın).
 *
 * "Verileri yenile" butonunun yanında, sağ üst köşede konumlanır.
 */
export function ViewModeToggle({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const setMode = (mode: "customer" | "region") => {
    if (mode === current) return;
    const params = new URLSearchParams(sp.toString());
    if (mode === "region") {
      params.set("view", "region");
      // Region görünümünde drill-down filtreleri sıfırlanır — `bolge` legacy
      // TBLDISTGRUP filtresi, `region` klasik bölge drill-down'u. Bölge
      // görünümünde 7 bölge eşit gösterildiği için ikisi de anlamsız kalır.
      params.delete("bolge");
      params.delete("region");
    } else {
      params.delete("view");
    }
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  };

  return (
    <div className="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setMode("customer")}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors",
          current === "customer"
            ? "bg-surface text-fg shadow-xs"
            : "text-muted hover:text-fg",
        )}
        title="Müşteri bazlı — her noktaya tıklanabilir"
      >
        <MapIcon size={13} />
        Müşteri
      </button>
      <button
        type="button"
        onClick={() => setMode("region")}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors",
          current === "region"
            ? "bg-surface text-fg shadow-xs"
            : "text-muted hover:text-fg",
        )}
        title="Bölge bazlı — TBLDISTGRUP ile aggregate; balona tıklayınca müşterilere iner"
      >
        <Layers size={13} />
        Bölge
      </button>
    </div>
  );
}
