"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { t as translate, type Locale } from "@/lib/i18n";

/**
 * md2 (Birleşik) — Cockpit global Periyot kontrolü. TEK periyot seçici:
 * seçim URL'e (`?periyot`) yazılır ve trend panellerini (Kanal Mix) sürer.
 * Kanal Mix'in eski yerel 3/6/12-ay seçicisi kaldırıldı — artık bu global
 * kontrol onu sürüyor. Anlık KPI şeridi "Son 30 gün" kalır (trend uzunluğundan
 * ayrı kavram). Diğer query param'ları (reel/otv/unit/bolge/kanal) korunur.
 */
// PERIYOT_KEYS + periyotLabel server-güvenli `./periyot-options` modülüne taşındı
// (RSC: client modülünden export edilen FONKSİYON server'dan çağrılamaz — Cockpit
// SSR crash veriyordu). Server (page.tsx) ve client burayı DEĞİL, doğrudan
// `./periyot-options`'ı import eder.
import { PERIYOT_KEYS } from "./periyot-options";

export function KomutaPeriyotDropdown({ periyot, locale = "tr" }: { periyot: string; locale?: Locale }) {
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

  const cur = PERIYOT_KEYS.some((o) => o.kod === periyot) ? periyot : "p12";
  const isNonDefault = cur !== "p12";
  const label = translate(locale, "komuta.periyot.label", "Periyot");

  return (
    <label className={`kf-chip${isNonDefault ? " on" : ""}`}>
      <span className="kf-lbl">{label}</span>
      <select
        value={cur}
        onChange={(e) => setParam(e.target.value)}
        disabled={isPending}
        aria-label={label}
      >
        {PERIYOT_KEYS.map((o) => (
          <option key={o.kod} value={o.kod}>{translate(locale, o.key, o.trDefault)}</option>
        ))}
      </select>
    </label>
  );
}
