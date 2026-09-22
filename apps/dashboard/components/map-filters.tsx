"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Filter, Loader2, Search, X } from "lucide-react";
import type { MapCustomer, MapFacets } from "@/lib/api";
import { t as translate, type Locale } from "@/lib/i18n";

type Props = {
  facets: MapFacets;
  customers: MapCustomer[];
  count: number;
  /**
   * Filtreleri uygularken router.push hedefi. /map (V1) veya /v2/harita (V2).
   * V2'den V1'e atlamamak için her drill-down aynı path'e push'lar.
   */
  basePath?: string;
  locale?: Locale;
};

export const FLY_TO_EVENT = "enroute:fly-to";

export type FlyToDetail = {
  customer: MapCustomer;
};

export function MapFilters({ facets, customers, count, basePath = "/map", locale = "tr" }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const sehir = params.get("sehir") ?? "";
  const distKod = params.get("distKod") ?? "";
  const salesFilter = params.get("salesFilter") ?? "";
  // Yeni composite tier filter. Eski `riskTier` URL param'ı varsa görmezden
  // gelinmez ama UI yeni `tier`'ı yazar (geri uyumluluk: eski deep-link'ler
  // hâlâ çalışır, sadece select yeni tier'ı yansıtır).
  const tier = params.get("tier") ?? "";
  const minDaysSinceVisit = params.get("minDaysSinceVisit") ?? "";
  // md11 — üstteki dönem filtresi (30/60/90g). Whitelist dışıysa 30 varsayılan.
  const activityDaysParam = Number(params.get("activityDays"));
  const activityDays: 30 | 60 | 90 =
    activityDaysParam === 60 || activityDaysParam === 90 ? activityDaysParam : 30;
  // customers zaten bu pencereye göre hesaplanmış `activityCiro` taşıyor
  // (bkz. packages/core/src/map.ts listMapCustomers) — toplamı burada, ekstra
  // fetch olmadan çıkarıyoruz.
  const totalActivityCiro = useMemo(
    () => customers.reduce((sum, c) => sum + (c.activityCiro ?? c.ciro30 ?? 0), 0),
    [customers],
  );

  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    // md9: ünvan + kısa ad yanında müşteri kodu (TXTKOD) ve takip kodu
    // (TXTERPKOD) üzerinden de eşleşme. Kodlar noktalı/boşluklu olabildiği
    // için ("120.01.3341") arama terimindeki ayraçları da temizleyip
    // ikinci bir karşılaştırma yapıyoruz — kullanıcı "1200 13341" yazsa da
    // bulabilsin.
    const t = q.trim().toLocaleLowerCase("tr");
    if (t.length < 2) return [];
    const tCompact = t.replace(/[.\s-]/g, "");
    return customers
      .filter((c) => {
        const unvan = c.unvan.toLocaleLowerCase("tr");
        const kisa = (c.kisaAd ?? "").toLocaleLowerCase("tr");
        const musteriKodu = (c.musteriKodu ?? "").toLocaleLowerCase("tr");
        const takipKodu = (c.takipKodu ?? "").toLocaleLowerCase("tr");
        if (unvan.includes(t) || kisa.includes(t)) return true;
        if (musteriKodu.includes(t) || takipKodu.includes(t)) return true;
        if (tCompact.length >= 2) {
          if (musteriKodu.replace(/[.\s-]/g, "").includes(tCompact)) return true;
          if (takipKodu.replace(/[.\s-]/g, "").includes(tCompact)) return true;
        }
        return false;
      })
      .slice(0, 10);
  }, [q, customers]);

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    startTransition(() => {
      router.push(`${basePath}?${sp.toString()}`);
    });
  }

  function reset() {
    setQ("");
    startTransition(() => {
      router.push(basePath);
    });
  }

  function pick(c: MapCustomer) {
    setQ("");
    window.dispatchEvent(
      new CustomEvent<FlyToDetail>(FLY_TO_EVENT, { detail: { customer: c } }),
    );
  }

  const hasFilter =
    !!sehir || !!distKod || !!salesFilter || !!q || !!tier || !!minDaysSinceVisit ||
    activityDays !== 30;

  const inputCls =
    "w-full bg-surface border border-border rounded-md px-3 h-9 text-sm shadow-xs " +
    "transition-colors focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 " +
    "disabled:opacity-50 disabled:cursor-not-allowed";
  const labelCls = "text-[10px] uppercase tracking-wider text-muted font-semibold";

  return (
    <aside className="w-72 shrink-0 border-r border-border bg-surface/60 backdrop-blur p-4 space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted font-semibold">
          <Filter size={11} />
          {translate(locale, "map.filters.title", "Filtreler")}
        </div>
        {hasFilter && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg transition-colors"
          >
            <X size={11} /> {translate(locale, "map.filters.clear", "Temizle")}
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>{translate(locale, "map.filters.search", "Arama")}</label>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={translate(locale, "map.filters.search_placeholder", "Ünvan, müşteri kodu veya takip kodu…")}
            className={inputCls + " pl-8"}
          />
        </div>
        {hits.length > 0 && (
          <ul className="rounded-md border border-border bg-surface overflow-hidden shadow-sm">
            {hits.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent-soft)] border-b border-border/60 last:border-b-0 transition-colors"
                >
                  <div className="truncate font-medium">{c.unvan}</div>
                  {c.kisaAd && c.kisaAd !== c.unvan && (
                    <div className="text-[11px] text-muted truncate italic mt-0.5">{c.kisaAd}</div>
                  )}
                  <div className="text-[11px] text-muted truncate mt-0.5">
                    {[c.ilce, c.sehir].filter(Boolean).join(" / ")}
                    {c.distributor ? ` · ${c.distributor}` : ""}
                  </div>
                  {(c.musteriKodu || c.takipKodu) && (
                    <div className="text-[10px] text-muted-2 truncate mt-0.5 font-mono">
                      {c.musteriKodu ? `${translate(locale, "map.filters.code", "Kod")}: ${c.musteriKodu}` : ""}
                      {c.musteriKodu && c.takipKodu ? " · " : ""}
                      {c.takipKodu ? `${translate(locale, "map.filters.tracking_code", "Takip")}: ${c.takipKodu}` : ""}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && hits.length === 0 && (
          <div className="text-[11px] text-muted italic">{translate(locale, "map.filters.no_match", "Eşleşme yok.")}</div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>{translate(locale, "map.filters.city", "Şehir")}</label>
        <select
          value={sehir}
          onChange={(e) => update({ sehir: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">{translate(locale, "map.filters.all_cities", "Tüm şehirler")}</option>
          {facets.cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>{translate(locale, "map.filters.distributor", "Distribütör")}</label>
        <select
          value={distKod}
          onChange={(e) => update({ distKod: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">{translate(locale, "map.filters.all_distributors", "Tüm distribütörler")}</option>
          {facets.distributors.map((d) => (
            <option key={d.lngKod} value={String(d.lngKod)}>
              {d.ad}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>
          {translate(locale, "map.filters.sales_activity", "Satış aktivitesi ({days} gün)", { days: activityDays })}
        </label>
        <select
          value={salesFilter}
          onChange={(e) => update({ salesFilter: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">{translate(locale, "komuta.all", "Tümü")}</option>
          <option value="with">{translate(locale, "map.filters.with_sales", "Sadece satışı olanlar")}</option>
          <option value="without">{translate(locale, "map.filters.without_sales", "Sadece sessiz müşteriler")}</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>{translate(locale, "map.filters.risk_level", "Risk seviyesi")}</label>
        <select
          value={tier}
          // tier seçilince eski `riskTier` URL param'ı da temizlensin —
          // backend her ikisini de okur, çakışma olmasın.
          onChange={(e) =>
            update({ tier: e.target.value, riskTier: "" })
          }
          disabled={isPending}
          className={inputCls}
        >
          <option value="">{translate(locale, "komuta.all", "Tümü")}</option>
          <option value="critical">{translate(locale, "map.risk.critical", "Kritik")} (75-100)</option>
          <option value="risk">{translate(locale, "map.risk.risky", "Riskli")} (55-74)</option>
          <option value="watch">{translate(locale, "map.risk.watch", "İzlemede")} (30-54)</option>
          <option value="healthy">{translate(locale, "map.risk.healthy", "Sağlıklı")} (0-29)</option>
          <option value="unknown">{translate(locale, "map.filters.insufficient_data", "Yetersiz veri")}</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>{translate(locale, "map.filters.days_since_visit", "Ziyaretsiz süre")}</label>
        <select
          value={minDaysSinceVisit}
          onChange={(e) => update({ minDaysSinceVisit: e.target.value })}
          disabled={isPending}
          className={inputCls}
        >
          <option value="">{translate(locale, "map.filters.duration_any", "Süre fark etmez")}</option>
          <option value="30">{translate(locale, "map.filters.days_since_visit_n", "{n}+ gündür ziyaretsiz", { n: 30 })}</option>
          <option value="60">{translate(locale, "map.filters.days_since_visit_n", "{n}+ gündür ziyaretsiz", { n: 60 })}</option>
          <option value="90">{translate(locale, "map.filters.days_since_visit_n", "{n}+ gündür ziyaretsiz", { n: 90 })}</option>
          <option value="180">{translate(locale, "map.filters.days_since_visit_n", "{n}+ gündür ziyaretsiz", { n: 180 })}</option>
        </select>
      </div>

      <div className="pt-3 border-t border-border text-xs">
        {isPending ? (
          <span className="flex items-center gap-2 text-muted">
            <Loader2 size={12} className="animate-spin text-accent" />
            {translate(locale, "map.filters.loading", "Yükleniyor…")}
          </span>
        ) : (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-muted">{translate(locale, "map.filters.shown", "Görüntülenen")}</span>
              <span className="text-fg font-semibold tabular-nums">
                {count.toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted">
                {translate(locale, "map.filters.revenue_last_n", "Ciro (son {days}g)", { days: activityDays })}
              </span>
              <span className="text-fg font-semibold tabular-nums">
                {Math.round(totalActivityCiro).toLocaleString(locale === "en" ? "en-US" : "tr-TR")} ₺
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
