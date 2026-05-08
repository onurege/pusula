"use client";

import { useEffect, useState } from "react";
import type { CustomerSales, MapCustomer } from "@/lib/api";
import { explainOnRadar, getCustomerSales } from "@/lib/api";

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

type Props = {
  customer: MapCustomer;
  onClose: () => void;
};

export function CustomerModal({ customer, onClose }: Props) {
  const [sales, setSales] = useState<SalesState>({ kind: "loading" });
  const [explain, setExplain] = useState<ExplainState>({ kind: "idle" });

  // Fetch detail when the modal opens / customer changes.
  useEffect(() => {
    let cancelled = false;
    setSales({ kind: "loading" });
    setExplain({ kind: "idle" });
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
        `Univera ERP'de "${customer.unvan}" adlı müşteri (TBLMUSTERI.LNGKOD = ${customer.id}, distribütör: ${customer.distributor ?? "—"}, şehir: ${customer.sehir ?? "—"}). Son 30 gün satış cirosu ${Number(s.ciro30 ?? 0).toLocaleString("tr-TR")} ₺ ve ${s.fatura30} satış faturası kaydı var. Ziyaret sayısı: ${s.ziyaret30} (rut içi ${s.rutIciZiyaret}, rut dışı ${s.rutDisiZiyaret}). Bu müşterinin son 30 gündeki **ürün grubu / marka kırılımını** TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUN üzerinden çıkar (TBLMSDFATURA.LNGMUSTERIKOD = ${customer.id} AND BYTTUR=0 AND BYTDURUM=0). En çok ciro getiren 2-3 marka veya ürün grubunu somut adlarıyla, miktarlarıyla ver. 2-3 cümlelik Türkçe yönetici özeti yaz.`,
      );
      setExplain({ kind: "ok", brief: res.brief, sql: res.sql });
    } catch (err) {
      setExplain({ kind: "err", message: (err as Error).message });
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

              {/* AI Analizi */}
              <section className="pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={runExplain}
                  disabled={explain.kind === "loading"}
                  className="w-full inline-flex items-center justify-center gap-2 bg-accent text-accent-fg px-4 h-10 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40"
                >
                  {explain.kind === "loading" ? "Analiz ediliyor…" : "AI Analizi al"}
                </button>

                {explain.kind === "err" && (
                  <div className="mt-3 text-sm text-bad">
                    <code className="text-xs">{explain.message}</code>
                  </div>
                )}
                {explain.kind === "ok" && explain.brief && (
                  <div className="mt-3 rounded-lg border border-accent/40 bg-accent/5 p-4">
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
