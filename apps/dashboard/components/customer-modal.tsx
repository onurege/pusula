"use client";

import { useEffect, useState } from "react";
import type { CustomerSales, ForesightResult, MapCustomer } from "@/lib/api";
import { explainOnRadar, getCustomerForesight, getCustomerSales } from "@/lib/api";

type SalesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: CustomerSales }
  | { kind: "err"; message: string };

type ExplainState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; brief?: string; sql?: string }
  | { kind: "err"; message: string };

type ForesightState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: ForesightResult }
  | { kind: "err"; message: string };

type Props = {
  customer: MapCustomer;
  onClose: () => void;
};

export function CustomerModal({ customer, onClose }: Props) {
  const [sales, setSales] = useState<SalesState>({ kind: "loading" });
  const [explain, setExplain] = useState<ExplainState>({ kind: "idle" });
  const [foresight, setForesight] = useState<ForesightState>({ kind: "idle" });

  // Fetch detail when the modal opens / customer changes.
  useEffect(() => {
    let cancelled = false;
    setSales({ kind: "loading" });
    setExplain({ kind: "idle" });
    setForesight({ kind: "idle" });
    getCustomerSales(customer.id, customer.distKod)
      .then((data) => !cancelled && setSales({ kind: "ok", data }))
      .catch((err) => !cancelled && setSales({ kind: "err", message: (err as Error).message }));
    return () => {
      cancelled = true;
    };
  }, [customer.id, customer.distKod]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function runExplain() {
    if (sales.kind !== "ok") return;
    const s = sales.data;
    setExplain({ kind: "loading" });
    try {
      const res = await explainOnRadar(
        "sales",
        `Univera ERP'de "${customer.unvan}" adlı müşteri (TBLMUSTERI.LNGKOD = ${customer.id}, distribütör: ${customer.distributor ?? "—"}, şehir: ${customer.sehir ?? "—"}). Son 30 gün satış cirosu ${Math.round(Number(s.ciro30 ?? 0)).toLocaleString("tr-TR")} ₺ ve ${s.fatura30} satış faturası kaydı var. Ziyaret sayısı: ${s.ziyaret30} (rut içi ${s.rutIciZiyaret}, rut dışı ${s.rutDisiZiyaret}). Bu müşterinin son 30 gündeki **ürün grubu / marka kırılımını** TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUN + TBLURUNGRUP üzerinden çıkar (TBLMSDFATURA.LNGMUSTERIKOD = ${customer.id} AND BYTTUR=0 AND BYTDURUM=0). Eğer ürün grubu kırılımı 0 satır verirse (TBLURUNGRUP join'i tutmazsa), ürün-seviyesinde TBLURUN.TXTAD ile dene. En çok ciro getiren 2-3 ürün grubunu (yoksa ürünü) somut adlarıyla, miktarlarıyla ver. 2-3 cümlelik Türkçe yönetici özeti yaz.`,
      );
      if (!res.brief) {
        setExplain({
          kind: "err",
          message: "Agent yanıt üretmedi. Sunucu loglarına bak (en olası: tablo retrieve edilemedi).",
        });
        return;
      }
      setExplain({ kind: "ok", brief: res.brief, sql: res.sql });
    } catch (err) {
      setExplain({ kind: "err", message: (err as Error).message });
    }
  }

  async function runForesight() {
    setForesight({ kind: "loading" });
    try {
      const data = await getCustomerForesight(customer.id, customer.unvan, 14);
      setForesight({ kind: "ok", data });
    } catch (err) {
      setForesight({ kind: "err", message: (err as Error).message });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight truncate">{customer.unvan}</h2>
            {customer.kisaAd && customer.kisaAd !== customer.unvan && (
              <div className="text-sm text-fg/70 mt-0.5 truncate">{customer.kisaAd}</div>
            )}
            <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {customer.distributor && (
                <span className="text-accent">{customer.distributor}</span>
              )}
              {customer.adres && <span>{customer.adres}</span>}
              {(customer.ilce || customer.sehir) && (
                <span>{[customer.ilce, customer.sehir].filter(Boolean).join(" / ")}</span>
              )}
              <span className="text-muted/70">#{customer.id}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-fg text-2xl leading-none -mt-1 px-2"
            aria-label="Kapat"
          >
            ×
          </button>
        </header>

        <div className="p-6 space-y-6">
          {sales.kind === "loading" && (
            <div className="text-sm text-muted text-center py-12">
              Müşteri detayı yükleniyor…
            </div>
          )}

          {sales.kind === "err" && (
            <div className="rounded-md border border-bad/40 bg-bad/10 p-4 text-sm">
              <div className="font-medium text-bad mb-1">Detay alınamadı</div>
              <code className="text-xs text-muted">{sales.message}</code>
            </div>
          )}

          {sales.kind === "ok" && (
            <>
              {/* Top KPI grid */}
              <section>
                <SectionHeading>Son 30 Gün Özet</SectionHeading>
                <div className="grid grid-cols-3 gap-3">
                  <KpiTile
                    label="Ciro"
                    value={`${formatCompact(sales.data.ciro30)} ₺`}
                  />
                  <KpiTile
                    label="Fatura"
                    value={Number(sales.data.fatura30 ?? 0).toLocaleString("tr-TR")}
                  />
                  <KpiTile
                    label="Ziyaret"
                    value={Number(sales.data.ziyaret30 ?? 0).toLocaleString("tr-TR")}
                  />
                </div>
                {(sales.data.sonFaturaTarihi || sales.data.sonZiyaretTarihi) && (
                  <div className="text-xs text-muted mt-3 flex flex-wrap gap-x-4 gap-y-1">
                    {sales.data.sonFaturaTarihi && (
                      <span>
                        Son fatura:{" "}
                        <span className="text-fg">
                          {new Date(sales.data.sonFaturaTarihi).toLocaleDateString("tr-TR")}
                        </span>
                      </span>
                    )}
                    {sales.data.sonZiyaretTarihi && (
                      <span>
                        Son ziyaret:{" "}
                        <span className="text-fg">
                          {new Date(sales.data.sonZiyaretTarihi).toLocaleDateString("tr-TR")}
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </section>

              {/* Tahsilat */}
              <section>
                <SectionHeading>Tahsilat</SectionHeading>
                <div className="grid grid-cols-4 gap-2">
                  <MiniTile label="Nakit" value={`${formatCompact(sales.data.tahsilatNakit)} ₺`} />
                  <MiniTile label="Çek" value={`${formatCompact(sales.data.tahsilatCek)} ₺`} />
                  <MiniTile label="Senet" value={`${formatCompact(sales.data.tahsilatSenet)} ₺`} />
                  <MiniTile label="Kredi K." value={`${formatCompact(sales.data.tahsilatKK)} ₺`} />
                </div>
                <div className="text-[11px] text-muted mt-2">
                  Toplam:{" "}
                  <span className="text-fg tabular-nums">
                    {formatCompact(
                      sales.data.tahsilatNakit +
                        sales.data.tahsilatCek +
                        sales.data.tahsilatSenet +
                        sales.data.tahsilatKK,
                    )}{" "}
                    ₺
                  </span>
                </div>
              </section>

              {/* Ziyaret kırılımı */}
              <section>
                <SectionHeading>Ziyaret Detayı</SectionHeading>
                <div className="grid grid-cols-2 gap-2">
                  <MiniTile
                    label="Rut içi ziyaret"
                    value={Number(sales.data.rutIciZiyaret ?? 0).toLocaleString("tr-TR")}
                  />
                  <MiniTile
                    label="Rut dışı ziyaret"
                    value={Number(sales.data.rutDisiZiyaret ?? 0).toLocaleString("tr-TR")}
                  />
                </div>
              </section>

              {/* Belge sayıları (ziyaret içinde) */}
              <section>
                <SectionHeading>Sahada Belge</SectionHeading>
                <div className="grid grid-cols-3 gap-2">
                  <MiniTile
                    label="Fatura"
                    value={Number(sales.data.ziyaretFaturaSayisi ?? 0).toLocaleString("tr-TR")}
                  />
                  <MiniTile
                    label="İrsaliye"
                    value={Number(sales.data.ziyaretIrsaliyeSayisi ?? 0).toLocaleString("tr-TR")}
                  />
                  <MiniTile
                    label="Sipariş"
                    value={Number(sales.data.ziyaretSiparisSayisi ?? 0).toLocaleString("tr-TR")}
                  />
                </div>
              </section>

              {/* AI Analizi + Öngörü */}
              <section className="pt-2 border-t border-border space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={runExplain}
                    disabled={explain.kind === "loading"}
                    className="inline-flex items-center justify-center gap-2 bg-accent text-accent-fg px-4 h-10 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40"
                  >
                    {explain.kind === "loading" ? "Analiz ediliyor…" : "AI Analizi al"}
                  </button>
                  <button
                    type="button"
                    onClick={runForesight}
                    disabled={foresight.kind === "loading"}
                    className="inline-flex items-center justify-center gap-2 border border-accent text-accent px-4 h-10 rounded-md text-sm font-medium hover:bg-accent/5 disabled:opacity-40"
                  >
                    {foresight.kind === "loading" ? "Öngörü çıkarılıyor…" : "Öngörü al (14 gün)"}
                  </button>
                </div>

                {explain.kind === "err" && (
                  <div className="text-sm text-bad">
                    <code className="text-xs">{explain.message}</code>
                  </div>
                )}
                {explain.kind === "ok" && explain.brief && (
                  <div className="rounded-lg border border-accent/40 bg-accent/5 p-4">
                    <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-2">
                      AI Analizi
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {explain.brief}
                    </div>
                    {explain.sql && (
                      <details className="mt-3">
                        <summary className="text-xs text-muted cursor-pointer hover:text-fg">
                          Kullanılan SQL
                        </summary>
                        <pre className="mt-2 text-[11px] font-mono leading-relaxed overflow-auto bg-bg p-3 rounded">
                          {explain.sql}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                {foresight.kind === "err" && (
                  <div className="text-sm text-bad">
                    <code className="text-xs">{foresight.message}</code>
                  </div>
                )}
                {foresight.kind === "ok" && (
                  <ForesightPanel data={foresight.data} />
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
      {children}
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums mt-1.5 leading-none">
        {value}
      </div>
    </div>
  );
}

function MiniTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-base font-semibold tracking-tight tabular-nums mt-1 leading-none">
        {value}
      </div>
    </div>
  );
}

function formatCompact(n: number): string {
  if (typeof n !== "number" || isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000_000)
    return (n / 1_000_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mr";
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mn";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

function ForesightPanel({ data }: { data: ForesightResult }) {
  const hasSignals =
    data.events.length > 0 ||
    data.yoy.length > 0 ||
    data.dropped.length > 0 ||
    data.cohort.length > 0;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-accent font-semibold">
          Öngörü · sonraki 14 gün
        </div>
        {data.riskFlags.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-bad bg-bad/15 border border-bad/30 px-1.5 py-0.5 rounded">
            ● Risk · {data.riskFlags.length}
          </span>
        )}
      </div>

      {data.riskFlags.length > 0 && (
        <div className="rounded-md border border-bad/40 bg-bad/10 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-bad">
            Yüksek öncelikli risk
          </div>
          <ul className="space-y-1">
            {data.riskFlags.map((r, i) => (
              <li key={i} className="text-sm leading-snug text-fg">
                {r.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.brief && (
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {data.brief}
        </div>
      )}

      {data.actions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">
            Önerilen aksiyonlar
          </div>
          <ul className="space-y-1.5">
            {data.actions.map((a, i) => (
              <li key={i} className="text-sm flex gap-2">
                <span className="text-accent font-semibold tabular-nums">{i + 1}.</span>
                <span className="flex-1">{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasSignals && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted hover:text-fg">
            Sinyaller (kaynak veri)
          </summary>
          <div className="mt-2 space-y-3">
            {data.events.length > 0 && (
              <ForesightSignalList
                title="Takvim"
                items={data.events.map(
                  (e) => `${e.date} (T+${e.daysAhead}g) — ${e.name}`,
                )}
              />
            )}
            {data.yoy.length > 0 && (
              <ForesightSignalList
                title="Geçen yıl bu hafta"
                items={data.yoy.slice(0, 5).map(
                  (y) =>
                    `${y.urunGrubu ?? "(grup yok)"} — ${Math.round(y.ciro).toLocaleString("tr-TR")} ₺ / ${Math.round(y.miktar).toLocaleString("tr-TR")} adet`,
                )}
              />
            )}
            {data.dropped.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">
                  Düşmüş kategoriler
                </div>
                <ul className="space-y-0.5 list-disc pl-4 text-[11px]">
                  {data.dropped.slice(0, 5).map((d, i) => (
                    <li key={i} className="leading-snug">
                      <UrgencyBadge urgency={d.urgency} />{" "}
                      {d.urunGrubu} — eskiden{" "}
                      {Math.round(d.baselineCiro).toLocaleString("tr-TR")} ₺,{" "}
                      {d.daysSinceLast ?? "?"} gündür yok
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.cohort.length > 0 && (
              <ForesightSignalList
                title="Segment kıyası (aldı, bu müşteri almadı)"
                items={data.cohort.slice(0, 5).map(
                  (c) =>
                    `${c.urunGrubu} — ${c.cohortBuyerCount}/${c.cohortTotalBuyers} müşteri aldı`,
                )}
              />
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function ForesightSignalList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">
        {title}
      </div>
      <ul className="space-y-0.5 list-disc pl-4 text-[11px]">
        {items.map((it, i) => (
          <li key={i} className="leading-snug">{it}</li>
        ))}
      </ul>
    </div>
  );
}

function UrgencyBadge({ urgency }: { urgency: "high" | "medium" | "low" }) {
  if (urgency === "high") {
    return (
      <span className="inline-block text-[9px] uppercase tracking-wider font-bold text-bad bg-bad/15 border border-bad/30 px-1 rounded">
        Yüksek
      </span>
    );
  }
  if (urgency === "medium") {
    return (
      <span className="inline-block text-[9px] uppercase tracking-wider font-bold text-warn bg-warn/15 border border-warn/30 px-1 rounded">
        Orta
      </span>
    );
  }
  return (
    <span className="inline-block text-[9px] uppercase tracking-wider font-bold text-muted bg-muted/15 border border-muted/30 px-1 rounded">
      Düşük
    </span>
  );
}
