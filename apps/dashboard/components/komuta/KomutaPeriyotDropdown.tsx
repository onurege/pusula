"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * md2 (Birleşik) — Cockpit global Periyot kontrolü. TEK periyot seçici:
 * seçim URL'e (`?periyot`) yazılır ve trend panellerini (Kanal Mix) sürer.
 * Kanal Mix'in eski yerel 3/6/12-ay seçicisi kaldırıldı — artık bu global
 * kontrol onu sürüyor. Anlık KPI şeridi "Son 30 gün" kalır (trend uzunluğundan
 * ayrı kavram). Diğer query param'ları (reel/otv/unit/bolge/kanal) korunur.
 */
const PERIYOT_OPTS: { kod: string; ad: string }[] = [
  { kod: "p3", ad: "Son 3 Ay" },
  { kod: "p6", ad: "Son 6 Ay" },
  { kod: "p12", ad: "Son 12 Ay" },
  { kod: "ytd", ad: "Bu Yıl" },
];

export function KomutaPeriyotDropdown({ periyot }: { periyot: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParam(val: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    // p12 = varsayılan → param'ı temiz tut (URL sade kalsın)
    if (!val || val === "p12") params.delete("periyot");
    else params.set("periyot", val);
    const qs = params.toString();
    startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  const cur = PERIYOT_OPTS.some((o) => o.kod === periyot) ? periyot : "p12";
  const isNonDefault = cur !== "p12";

  return (
    <label className={`kf-chip${isNonDefault ? " on" : ""}`}>
      <span className="kf-lbl">Periyot</span>
      <select
        value={cur}
        onChange={(e) => setParam(e.target.value)}
        disabled={isPending}
        aria-label="Periyot"
      >
        {PERIYOT_OPTS.map((o) => (
          <option key={o.kod} value={o.kod}>{o.ad}</option>
        ))}
      </select>
    </label>
  );
}
