"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Calendar,
  Check,
  Hash,
  MapPin,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  TrendingDown,
  Users,
  X,
} from "lucide-react";
import type { CustomerSales, ForesightResult, MapCustomer } from "@/lib/api";
import { explainOnRadar, getCustomerForesight, getCustomerSales } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { addAction as addWeeklyAction } from "@/components/weekly-actions/store";

type SalesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: CustomerSales }
  | { kind: "err"; message: string };

/**
 * Ödeme skoru — son 30g tahsilat / ciro coverage'a dayalı.
 * Core'da `payment: null` hardcoded; detail data'sındaki tahsilat ham
 * rakamlarından display-time hesaplıyoruz.
 *
 * NOT: Daha güçlü sinyal olan kümülatif "cari bakiye" (TBLTCPMUSTERIBAKIYE)
 * Univera kurulumları arasında tutarsız bulundu — kaldırıldı. Bu basit
 * coverage modeli en azından son 30g penceresindeki ödeme davranışını
 * yansıtır.
 *
 * Skor (0=mükemmel, 100=kritik):
 *   coverage = toplam tahsilat / ciro30
 *   coverage >= 1.0   → 10
 *   coverage 0.8-1.0  → 25
 *   coverage 0.5-0.8  → 50
 *   coverage 0.2-0.5  → 75
 *   coverage < 0.2    → 90
 *   ciro > 0 & tahsilat = 0 → 80
 *   ciro = 0 & tahsilat = 0 → null
 *
 * Method risk (çek+senet payı): +10/+20 penalty.
 */
function computePaymentScore(sales: CustomerSales): number | null {
  const ciro = sales.ciro30 ?? 0;
  const tahsilatNakit = sales.tahsilatNakit ?? 0;
  const tahsilatCek = sales.tahsilatCek ?? 0;
  const tahsilatSenet = sales.tahsilatSenet ?? 0;
  const tahsilatKK = sales.tahsilatKK ?? 0;
  const toplam = tahsilatNakit + tahsilatCek + tahsilatSenet + tahsilatKK;
  if (ciro === 0 && toplam === 0) return null;
  if (ciro > 0 && toplam === 0) return 80;

  const coverage = ciro > 0 ? toplam / ciro : 1;
  let baseScore: number;
  if (coverage >= 1.0) baseScore = 10;
  else if (coverage >= 0.8) baseScore = 25;
  else if (coverage >= 0.5) baseScore = 50;
  else if (coverage >= 0.2) baseScore = 75;
  else baseScore = 90;

  const vade = tahsilatCek + tahsilatSenet;
  const vadeShare = toplam > 0 ? vade / toplam : 0;
  let methodPenalty = 0;
  if (vadeShare > 0.8) methodPenalty = 20;
  else if (vadeShare > 0.5) methodPenalty = 10;

  return Math.min(100, baseScore + methodPenalty);
}

/**
 * Risk skoru bileşenlerini sales detail ile zenginleştirir — özellikle
 * payment'i hesaplayıp overall skoru da yeniden ağırlıklandırır.
 *
 * RISK_WEIGHTS (core ile aynı): momentum 0.40, behavioral 0.30, payment 0.20,
 * engagement 0.10.
 */
function enhanceRiskScoreWithPayment(
  riskScore: MapCustomer["riskScore"],
  sales: CustomerSales,
): MapCustomer["riskScore"] {
  // unknown tier'a dokunma (zaten yeterli veri yok)
  if (riskScore.tier === "unknown") return riskScore;
  const paymentValue = computePaymentScore(sales);
  if (paymentValue === null) return riskScore; // payment hesaplanamadı, no-op

  const enhancedComponents = {
    ...riskScore.components,
    payment: paymentValue,
  };

  // Overall skoru yeniden hesapla (payment dahil, 4 bileşen weighted avg)
  const WEIGHTS = {
    momentum: 0.40,
    behavioral: 0.30,
    payment: 0.20,
    engagement: 0.10,
  };
  let wSum = 0;
  let weighted = 0;
  for (const [k, w] of Object.entries(WEIGHTS) as [
    keyof typeof WEIGHTS,
    number,
  ][]) {
    const v = enhancedComponents[k];
    if (v != null) {
      wSum += w;
      weighted += w * v;
    }
  }
  const newScore = wSum > 0 ? Math.round(weighted / wSum) : riskScore.score;
  const newTier =
    newScore == null
      ? "unknown"
      : newScore < 30
        ? "healthy"
        : newScore < 55
          ? "watch"
          : newScore < 75
            ? "risk"
            : "critical";

  // Eski "ödeme verisi yok" reason'u filtrele + payment context'i ekle
  const filteredReasons = riskScore.reasons.filter(
    (r) =>
      !r.startsWith("Ödeme/vade verisi mevcut değil") &&
      !r.startsWith("Ödeme verisi mevcut değil"),
  );
  const ciro = sales.ciro30 ?? 0;
  const toplam =
    (sales.tahsilatNakit ?? 0) +
    (sales.tahsilatCek ?? 0) +
    (sales.tahsilatSenet ?? 0) +
    (sales.tahsilatKK ?? 0);
  let paymentReason = "";
  if (ciro > 0 || toplam > 0) {
    const coverage = ciro > 0 ? toplam / ciro : null;
    const vadeShare = toplam > 0
      ? ((sales.tahsilatCek ?? 0) + (sales.tahsilatSenet ?? 0)) / toplam
      : 0;
    const covStr = coverage != null
      ? `tahsilat/ciro = %${(coverage * 100).toFixed(0)}`
      : `tahsilat var, fatura yok`;
    const methodStr = vadeShare > 0.5
      ? ` · çek/senet payı %${(vadeShare * 100).toFixed(0)} (vade riski)`
      : "";
    paymentReason = `Ödeme skoru tahsilat verisinden: ${covStr}${methodStr}.`;
  }

  return {
    ...riskScore,
    score: newScore,
    tier: newTier,
    components: enhancedComponents,
    reasons: paymentReason
      ? [...filteredReasons, paymentReason]
      : filteredReasons,
  };
}

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

  async function runForesight(opts: { refresh?: boolean } = {}) {
    setForesight({ kind: "loading" });
    try {
      const data = await getCustomerForesight(customer.id, customer.unvan, 14, {
        refresh: opts.refresh,
      });
      setForesight({ kind: "ok", data });
    } catch (err) {
      setForesight({ kind: "err", message: (err as Error).message });
    }
  }

  // When foresight has a result, expand the modal into a two-pane full-bleed
  // layout (customer info on the left, dashboard on the right). Otherwise
  // keep the centered card.
  const expanded = foresight.kind === "ok";

  // Mount-state gate so SSR doesn't trip on document.body during pre-render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  // Render through a portal so the modal escapes the map page's
  // `fixed inset-0 top-12` wrapper (which was clipping our z-index above the
  // global sticky navbar).
  return createPortal(
    <div
      className={
        "fixed inset-0 z-[60] flex bg-black/40 backdrop-blur-sm transition-all " +
        (expanded ? "items-stretch justify-stretch p-4" : "items-center justify-center p-4")
      }
      onClick={onClose}
    >
      <div
        className={
          "relative bg-surface shadow-2xl border border-border overflow-hidden transition-all " +
          (expanded
            ? "w-full h-full max-w-[1600px] mx-auto rounded-2xl flex"
            : "w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl")
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={
            expanded
              ? "flex-1 max-w-[640px] overflow-y-auto border-r border-border"
              : "contents"
          }
        >
        <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight truncate">{customer.unvan}</h2>
            {customer.kisaAd && customer.kisaAd !== customer.unvan && (
              <div className="text-sm text-fg-2 mt-0.5 truncate">{customer.kisaAd}</div>
            )}
            <div className="text-xs text-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <RiskTierBadge tier={customer.riskScore.tier} score={customer.riskScore.score} />
              {customer.distributor && (
                <Badge tone="accent" size="sm">
                  {customer.distributor}
                </Badge>
              )}
              {customer.adres && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={11} className="opacity-60" />
                  {customer.adres}
                </span>
              )}
              {(customer.ilce || customer.sehir) && (
                <span>{[customer.ilce, customer.sehir].filter(Boolean).join(" / ")}</span>
              )}
              <span className="inline-flex items-center gap-1 text-muted-2">
                <Hash size={11} />
                {customer.id}
              </span>
            </div>
            {(customer.daysSinceLastSale !== null || customer.daysSinceLastVisit !== null) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                {customer.daysSinceLastSale !== null && (
                  <span>
                    Son satış:{" "}
                    <span className="text-fg-2 font-medium">
                      {customer.daysSinceLastSale === 0
                        ? "bugün"
                        : `${customer.daysSinceLastSale} gün önce`}
                    </span>
                  </span>
                )}
                {customer.daysSinceLastVisit !== null && (
                  <span>
                    Son ziyaret:{" "}
                    <span className="text-fg-2 font-medium">
                      {customer.daysSinceLastVisit === 0
                        ? "bugün"
                        : `${customer.daysSinceLastVisit} gün önce`}
                    </span>
                  </span>
                )}
              </div>
            )}
            {/* Risk Skoru kartı header'ın altındaki content bloğunda gösteriliyor
                (full-width card formatında); burada başlık altında sadece
                tier rozet'i kalıyor. */}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 -mt-1 -mr-2 flex items-center justify-center rounded-md text-muted hover:text-fg hover:bg-surface-2 transition-colors"
            aria-label="Kapat"
          >
            <X size={18} />
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
              {/* Composite Risk Score — başlığın hemen altında öne çıkar.
                  Ödeme bileşeni sync sırasında null geliyor (Univera mirror'da
                  tahsilat snapshot'ı yok); detail fetch ile gelen tahsilat
                  verisinden display-time hesaplıyoruz ve overall score'u
                  yeniden ağırlıklandırıyoruz. */}
              <RiskScoreCard
                riskScore={enhanceRiskScoreWithPayment(customer.riskScore, sales.data)}
              />

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
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={runExplain}
                    loading={explain.kind === "loading"}
                    iconLeft={explain.kind !== "loading" ? <Sparkles size={15} /> : undefined}
                  >
                    {explain.kind === "loading" ? "Analiz ediliyor…" : "AI Analizi al"}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => runForesight()}
                    loading={foresight.kind === "loading"}
                    iconLeft={foresight.kind !== "loading" ? <Target size={15} /> : undefined}
                    className="border-accent/40 text-accent hover:bg-[var(--color-accent-soft)]"
                  >
                    {foresight.kind === "loading" ? "Öngörü çıkarılıyor…" : "Öngörü al (14 gün)"}
                  </Button>
                </div>

                {explain.kind === "err" && (
                  <Card tone="bad" padding="sm">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="text-bad mt-0.5 shrink-0" />
                      <code className="text-[11px] text-fg-2 leading-relaxed">{explain.message}</code>
                    </div>
                  </Card>
                )}
                {explain.kind === "ok" && explain.brief && (
                  <Card tone="accent" padding="md">
                    <CardHeader className="flex items-center gap-1.5 text-accent">
                      <Sparkles size={11} /> AI Analizi
                    </CardHeader>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {explain.brief}
                    </div>
                    {explain.sql && (
                      <details className="mt-3">
                        <summary className="text-xs text-muted cursor-pointer hover:text-fg">
                          Kullanılan SQL
                        </summary>
                        <pre className="mt-2 text-[11px] font-mono leading-relaxed overflow-auto bg-surface-3 p-3 rounded-md border border-border">
                          {explain.sql}
                        </pre>
                      </details>
                    )}
                  </Card>
                )}

                {foresight.kind === "err" && (
                  <Card tone="bad" padding="sm">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="text-bad mt-0.5 shrink-0" />
                      <code className="text-[11px] text-fg-2 leading-relaxed">{foresight.message}</code>
                    </div>
                  </Card>
                )}
                {/* When foresight loads, the modal expands and the right pane
                    hosts the dashboard, so no inline panel is needed here. */}
              </section>
            </>
          )}
        </div>
        </div>
        {expanded && foresight.kind === "ok" && (
          <div className="flex-1 overflow-y-auto bg-bg/40">
            <ForesightDashboard
              data={foresight.data}
              customer={customer}
              onRefresh={() => runForesight({ refresh: true })}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
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
    <div className="rounded-lg border border-border bg-surface p-4 shadow-xs hover:shadow-sm transition-shadow">
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums mt-1.5 leading-none">
        {value}
      </div>
    </div>
  );
}

function MiniTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3 hover:bg-surface-2/50 transition-colors">
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</div>
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

// ---------------------------------------------------------------------------
// Risk Skoru bileşenleri (composite, açıklanabilir)
// ---------------------------------------------------------------------------

type TierStyle = {
  label: string;
  badgeTone: "bad" | "warn" | "good" | "accent" | "muted";
  textCls: string;
  borderCls: string;
  softCls: string;
  barCls: string;
};

const TIER_STYLES: Record<MapCustomer["riskScore"]["tier"], TierStyle> = {
  critical: {
    label: "Kritik",
    badgeTone: "bad",
    textCls: "text-bad",
    borderCls: "border-bad/40",
    softCls: "bg-[var(--color-bad-soft)]",
    barCls: "bg-bad",
  },
  risk: {
    label: "Riskli",
    badgeTone: "warn",
    textCls: "text-tier-risk",
    borderCls: "border-tier-risk/40",
    softCls: "bg-tier-risk-soft",
    barCls: "bg-tier-risk",
  },
  watch: {
    label: "İzlemede",
    badgeTone: "warn",
    textCls: "text-warn",
    borderCls: "border-warn/40",
    softCls: "bg-[var(--color-warn-soft)]",
    barCls: "bg-warn",
  },
  healthy: {
    label: "Sağlıklı",
    badgeTone: "good",
    textCls: "text-good",
    borderCls: "border-good/40",
    softCls: "bg-[var(--color-good-soft)]",
    barCls: "bg-good",
  },
  unknown: {
    label: "Yetersiz veri",
    badgeTone: "muted",
    textCls: "text-muted",
    borderCls: "border-border",
    softCls: "bg-surface-2",
    barCls: "bg-muted-2",
  },
};

function RiskTierBadge({
  tier,
  score,
}: {
  tier: MapCustomer["riskScore"]["tier"];
  score: number | null;
}) {
  const s = TIER_STYLES[tier];
  return (
    <Badge tone={s.badgeTone} size="sm" dot>
      {score !== null ? `${score}/100 · ${s.label}` : s.label}
    </Badge>
  );
}

const COMPONENT_LABELS: Record<
  keyof MapCustomer["riskScore"]["components"],
  string
> = {
  momentum: "Satış Momentumu",
  behavioral: "Davranışsal",
  payment: "Ödeme",
  engagement: "Etkileşim",
};

function RiskScoreCard({
  riskScore,
}: {
  riskScore: MapCustomer["riskScore"];
}) {
  const s = TIER_STYLES[riskScore.tier];
  return (
    <section
      className={
        "rounded-lg border p-4 space-y-4 " +
        s.borderCls +
        " " +
        s.softCls
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            Risk Skoru
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={"text-3xl font-bold tracking-tight tabular-nums " + s.textCls}
            >
              {riskScore.score !== null ? riskScore.score : "—"}
            </span>
            <span className="text-sm text-muted">/100</span>
            <span className={"text-sm font-semibold " + s.textCls}>· {s.label}</span>
          </div>
        </div>
        <div className="text-[10px] text-muted-2 text-right leading-tight max-w-[180px]">
          Satış, davranış, ödeme ve etkileşim sinyallerinin bileşik skoru.
        </div>
      </div>

      {/* Bileşen barları */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {(Object.keys(COMPONENT_LABELS) as Array<keyof typeof COMPONENT_LABELS>).map(
          (key) => (
            <ComponentBar
              key={key}
              label={COMPONENT_LABELS[key]}
              value={riskScore.components[key]}
            />
          ),
        )}
      </div>

      {/* Reasons */}
      {riskScore.reasons.length > 0 && (
        <ul className="space-y-1 text-[11.5px] leading-snug text-fg-2 border-t border-border/60 pt-3">
          {riskScore.reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-2 shrink-0">·</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ComponentBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value));
  // Bar rengi değere göre — yüksek değer = kötü (kırmızı), düşük = iyi (yeşil)
  const barTone: keyof typeof TIER_STYLES =
    value === null
      ? "unknown"
      : value < 30
        ? "healthy"
        : value < 55
          ? "watch"
          : value < 75
            ? "risk"
            : "critical";
  const bar = TIER_STYLES[barTone].barCls;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[10.5px] uppercase tracking-wider text-muted font-semibold">
          {label}
        </span>
        <span
          className={
            "text-[11px] tabular-nums " +
            (value === null ? "text-muted-2" : "text-fg-2 font-medium")
          }
        >
          {value === null ? "veri yok" : Math.round(value)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        {value !== null && (
          <div
            className={"h-full rounded-full transition-all " + bar}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

function ForesightDashboard({
  data,
  customer,
  onRefresh,
}: {
  data: ForesightResult;
  customer: MapCustomer;
  onRefresh?: () => void;
}) {
  const yoyTotal = data.yoy.reduce((a, b) => a + b.ciro, 0);
  const yoyTop = data.yoy.slice(0, 8);
  const yoyMax = yoyTop[0]?.ciro ?? 1;

  // Hangi aksiyon zaten haftalık listeye eklendi — index bazlı set.
  // Foresight yeniden çekilirse (generatedAt değişir) sıfırla; yeni öneriler
  // duplicate işaretiyle açılmasın.
  const [addedActions, setAddedActions] = useState<Set<number>>(new Set());
  useEffect(() => {
    setAddedActions(new Set());
  }, [data.generatedAt]);

  const handleAddAction = (index: number, text: string) => {
    if (addedActions.has(index)) return;
    // Drawer'da chip'te uzun unvan'lar truncate ediliyor; mümkünse kısa adı
    // tercih et, yoksa tam unvan'a düş.
    const customerName = customer.kisaAd ?? customer.unvan;
    addWeeklyAction({
      text,
      source: "foresight",
      reason: "14 günlük müşteri foresight",
      customerId: customer.id,
      customerName,
      ...(customer.bolge ? { region: customer.bolge } : {}),
    });
    setAddedActions((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-accent font-semibold">
            <Target size={11} />
            Foresight · sonraki 14 gün
          </div>
          <div className="text-xl font-semibold tracking-tight mt-1">
            {customer.unvan}
          </div>
          <div className="text-[10px] text-muted tabular-nums mt-1">
            Üretildi: {new Date(data.generatedAt).toLocaleString("tr-TR")}
          </div>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs rounded-md border border-border bg-surface text-fg-2 hover:text-fg hover:bg-surface-2 transition-colors"
            title="Cache'i atlat ve MSSQL'den taze çek"
          >
            <RefreshCw size={12} />
            Yenile
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <DashKpi
          icon={<AlertCircle size={14} />}
          label="Risk sinyali"
          value={data.riskFlags.length}
          tone={data.riskFlags.length > 0 ? "bad" : "muted"}
        />
        <DashKpi
          icon={<Calendar size={14} />}
          label="14 günde olay"
          value={data.events.length}
          tone={data.events.length > 0 ? "accent" : "muted"}
        />
        <DashKpi
          icon={<TrendingDown size={14} />}
          label="Düşmüş kategori"
          value={data.dropped.length}
          tone={data.dropped.length > 0 ? "warn" : "muted"}
        />
        <DashKpi
          icon={<Users size={14} />}
          label="Segment fırsatı"
          value={data.cohort.length}
          tone={data.cohort.length > 0 ? "accent" : "muted"}
        />
      </div>

      {/* Risk banner — kept here for prominence even though inline panel had it */}
      {data.riskFlags.length > 0 && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-bad">
            <span className="size-2 rounded-full bg-bad animate-pulse" />
            Yüksek öncelikli risk
          </div>
          <ul className="space-y-1.5">
            {data.riskFlags.map((r, i) => (
              <li key={i} className="text-sm leading-snug">
                <span className="font-medium">{r.urunGrubu}</span> —
                eskiden {Math.round(r.baselineCiro).toLocaleString("tr-TR")} ₺
                alıyordu, {r.daysSinceLast ?? "?"} gündür hiç sipariş yok
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Brief */}
      {data.brief && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
            Yönetici brifi
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {data.brief}
          </div>
        </div>
      )}

      {/* Actions — first-class block */}
      {data.actions.length > 0 && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-accent font-semibold">
            Bu hafta yapılacak
          </div>
          <ol className="space-y-2.5">
            {data.actions.map((a, i) => {
              const isAdded = addedActions.has(i);
              return (
                <li key={i} className="text-sm flex gap-3 items-start">
                  <span className="shrink-0 size-6 rounded-full bg-accent text-accent-fg text-xs font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="flex-1 leading-snug pt-0.5">{a}</span>
                  <button
                    type="button"
                    onClick={() => handleAddAction(i, a)}
                    disabled={isAdded}
                    aria-label={
                      isAdded
                        ? "Bu aksiyon haftalık listeye eklendi"
                        : "Aksiyonu haftalık listeye ekle"
                    }
                    className={
                      "shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[11px] font-medium transition-colors " +
                      (isAdded
                        ? "border-good/40 bg-good-soft text-good cursor-default"
                        : "border-accent/40 bg-surface text-accent hover:bg-accent-soft")
                    }
                  >
                    {isAdded ? (
                      <>
                        <Check size={12} />
                        Eklendi
                      </>
                    ) : (
                      <>
                        <Plus size={12} />
                        Yapılacaklar'a ekle
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Calendar timeline */}
      {data.events.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-3">
            Takvim · sonraki 14 gün
          </div>
          <ol className="space-y-2">
            {data.events.map((e, i) => (
              <li key={i} className="flex gap-3 items-start">
                <div className="shrink-0 w-14 text-center">
                  <div className="text-[10px] text-muted leading-tight">
                    T+{e.daysAhead}g
                  </div>
                  <div className="text-xs font-mono">{e.date.slice(5)}</div>
                </div>
                <div className="flex-1 border-l border-border pl-3">
                  <div className="text-sm font-medium leading-tight">{e.name}</div>
                  <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5">
                    {e.kind}
                  </div>
                  {e.category_hints && e.category_hints.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {e.category_hints.slice(0, 6).map((h, j) => (
                        <span
                          key={j}
                          className="text-[10px] bg-accent/10 text-accent border border-accent/20 px-1.5 py-0.5 rounded"
                        >
                          {h}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* YoY top categories with mini bars */}
      {yoyTop.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
              Geçen yıl bu hafta · en üst kalemler
            </div>
            <div className="text-xs text-muted">
              Toplam:{" "}
              <span className="text-fg font-medium tabular-nums">
                {Math.round(yoyTotal).toLocaleString("tr-TR")} ₺
              </span>
            </div>
          </div>
          <div className="space-y-2.5">
            {yoyTop.map((y, i) => {
              const pct = (y.ciro / yoyMax) * 100;
              const share = yoyTotal > 0 ? (y.ciro / yoyTotal) * 100 : 0;
              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between text-xs mb-0.5">
                    <span className="truncate pr-2">{y.urunGrubu ?? "(grup yok)"}</span>
                    <span className="tabular-nums shrink-0 text-muted">
                      <span className="text-fg font-medium">
                        {Math.round(y.ciro).toLocaleString("tr-TR")} ₺
                      </span>
                      {" · "}
                      {share.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg rounded overflow-hidden">
                    <div
                      className="h-full bg-accent/70 rounded"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dropped categories table */}
      {data.dropped.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-3">
            Düşmüş kategoriler · re-engagement
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted text-[10px] uppercase tracking-wider border-b border-border">
                  <th className="text-left font-medium pb-2 pr-2">Kategori</th>
                  <th className="text-left font-medium pb-2 px-2">Öncelik</th>
                  <th className="text-right font-medium pb-2 px-2">Geçmiş ciro</th>
                  <th className="text-right font-medium pb-2 pl-2">Son sipariş</th>
                </tr>
              </thead>
              <tbody>
                {data.dropped.slice(0, 8).map((d, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-2 truncate max-w-[200px]">{d.urunGrubu}</td>
                    <td className="py-2 px-2">
                      <UrgencyBadge urgency={d.urgency} />
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {Math.round(d.baselineCiro).toLocaleString("tr-TR")} ₺
                    </td>
                    <td className="py-2 pl-2 text-right tabular-nums text-muted">
                      {d.daysSinceLast ?? "?"} gün
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cohort */}
      {data.cohort.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-3">
            Segment kıyası · aldı, bu hesap almadı
          </div>
          <div className="space-y-2.5">
            {data.cohort.slice(0, 6).map((c, i) => {
              const pen = c.cohortTotalBuyers > 0
                ? (c.cohortBuyerCount / c.cohortTotalBuyers) * 100
                : 0;
              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between text-xs mb-0.5">
                    <span className="truncate pr-2">{c.urunGrubu}</span>
                    <span className="tabular-nums shrink-0 text-muted">
                      <span className="text-fg font-medium">
                        {c.cohortBuyerCount}/{c.cohortTotalBuyers}
                      </span>
                      {" · "}
                      {pen.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg rounded overflow-hidden">
                    <div
                      className="h-full bg-good/60 rounded"
                      style={{ width: `${Math.min(pen, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.events.length === 0 &&
        data.yoy.length === 0 &&
        data.dropped.length === 0 &&
        data.cohort.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-bg/40 p-8 text-center text-sm text-muted">
            Önümüzdeki 14 günde bu müşteri için anlamlı bir sinyal yok.
          </div>
        )}
    </div>
  );
}

function DashKpi({
  icon,
  label,
  value,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  tone: "accent" | "warn" | "bad" | "muted";
}) {
  const toneClass =
    tone === "bad"
      ? "border-bad/30 bg-[var(--color-bad-soft)]"
      : tone === "warn"
      ? "border-warn/30 bg-[var(--color-warn-soft)]"
      : tone === "accent"
      ? "border-accent/30 bg-[var(--color-accent-soft)]"
      : "border-border bg-surface";
  const valueColor =
    tone === "bad"
      ? "text-bad"
      : tone === "warn"
      ? "text-warn"
      : tone === "accent"
      ? "text-accent"
      : "text-muted";
  const iconBg =
    tone === "bad"
      ? "bg-bad/10 text-bad"
      : tone === "warn"
      ? "bg-warn/10 text-warn"
      : tone === "accent"
      ? "bg-accent/10 text-accent"
      : "bg-surface-2 text-muted";
  return (
    <div className={`rounded-lg border p-3 shadow-xs ${toneClass}`}>
      <div className="flex items-center gap-2 mb-1.5">
        {icon && (
          <span className={`size-6 rounded-md flex items-center justify-center ${iconBg}`}>
            {icon}
          </span>
        )}
        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
          {label}
        </div>
      </div>
      <div className={`text-2xl font-semibold tabular-nums leading-none ${valueColor}`}>
        {value}
      </div>
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
