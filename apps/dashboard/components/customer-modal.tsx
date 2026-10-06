"use client";

import { Fragment, useEffect, useState } from "react";
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
import type {
  CustomerSales,
  ForesightResult,
  MapCustomer,
  PeerCrossSellItem,
  ReorderCrossSellItem,
  ReorderResult,
  WalletGapItem,
} from "@/lib/api";
import {
  explainOnRadar,
  getCustomerForesight,
  getCustomerReorder,
  getCustomerSales,
} from "@/lib/api-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { InfoHint } from "@/components/komuta/InfoHint";
import { addAction as addWeeklyAction } from "@/components/weekly-actions/store";
import { t as translate, type Locale } from "@/lib/i18n";
import { trackInteraction } from "@/lib/telemetry";

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
  locale: Locale = "tr",
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
      ? translate(locale, "customer.payment.coverage", "tahsilat/ciro = %{pct}", { pct: (coverage * 100).toFixed(0) })
      : translate(locale, "customer.payment.no_invoice", "tahsilat var, fatura yok");
    const methodStr = vadeShare > 0.5
      ? " " + translate(locale, "customer.payment.method_risk", "· çek/senet payı %{pct} (vade riski)", {
          pct: (vadeShare * 100).toFixed(0),
        })
      : "";
    paymentReason = translate(
      locale,
      "customer.payment.reason",
      "Ödeme skoru tahsilat verisinden: {cov}{method}.",
      { cov: covStr, method: methodStr },
    );
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

type ReorderState =
  | { kind: "loading" }
  | { kind: "ok"; data: ReorderResult }
  | { kind: "err"; message: string };

type Props = {
  customer: MapCustomer;
  onClose: () => void;
  locale?: Locale;
};

// ---------------------------------------------------------------------------
// Sekmeler — modal içeriğini tek uzun scroll yerine 2 panele böler: Özet
// (risk skoru + son 30g özet + tahsilat + ziyaret + sahada belge + AI &
// öngörü — reorder DIŞINDA her şey, mevcut sırayla) ve Sipariş Önerisi
// (ayrı, temiz panel). Veri-çekme (sales/reorder/explain/foresight) sekme
// seçiminden bağımsız, state hep `CustomerModal` gövdesinde kalır — sekme
// değişimi yalnızca görünürlüğü değiştirir (bkz. `hidden` attribute), fetch
// tetiklemez.
// ---------------------------------------------------------------------------

type TabId = "ozet" | "oneri";

const TABS: { id: TabId; key: string; fallback: string }[] = [
  { id: "ozet", key: "customer.tab.ozet", fallback: "Özet" },
  { id: "oneri", key: "customer.tab.oneri", fallback: "Sipariş Önerisi" },
];

function tabPanelId(id: TabId) {
  return `customer-tabpanel-${id}`;
}
function tabButtonId(id: TabId) {
  return `customer-tab-${id}`;
}

/** Ok tuşları (yatay) + Home/End ile roving focus; Enter/Space native button
 *  davranışıyla zaten çalışır. WAI-ARIA APG "Tabs" desenine uyar. */
function handleTabKeyDown(
  e: React.KeyboardEvent<HTMLButtonElement>,
  idx: number,
  onChange: (id: TabId) => void,
) {
  let nextIdx: number | null = null;
  if (e.key === "ArrowRight") nextIdx = (idx + 1) % TABS.length;
  else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + TABS.length) % TABS.length;
  else if (e.key === "Home") nextIdx = 0;
  else if (e.key === "End") nextIdx = TABS.length - 1;
  if (nextIdx === null) return;
  e.preventDefault();
  onChange(TABS[nextIdx].id);
  const tablist = e.currentTarget.closest('[role="tablist"]');
  const buttons = tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  buttons?.[nextIdx]?.focus();
}

function TabBar({
  active,
  onChange,
  locale,
}: {
  active: TabId;
  onChange: (id: TabId) => void;
  locale: Locale;
}) {
  return (
    <div
      role="tablist"
      aria-label={translate(locale, "customer.tabs.aria_label", "Müşteri detay sekmeleri")}
      className="px-6 flex gap-1 border-t border-border/60"
    >
      {TABS.map((tab, idx) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabButtonId(tab.id)}
            aria-controls={tabPanelId(tab.id)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, idx, onChange)}
            className={
              "px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-t-sm " +
              (selected
                ? "border-accent text-fg"
                : "border-transparent text-muted hover:text-fg-2 hover:border-border")
            }
          >
            {translate(locale, tab.key, tab.fallback)}
          </button>
        );
      })}
    </div>
  );
}

function TabPanel({
  id,
  active,
  children,
}: {
  id: TabId;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(id)}
      aria-labelledby={tabButtonId(id)}
      hidden={!active}
      tabIndex={0}
      className="space-y-6 focus-visible:outline-none"
    >
      {children}
    </div>
  );
}

export function CustomerModal({ customer, onClose, locale = "tr" }: Props) {
  const [sales, setSales] = useState<SalesState>({ kind: "loading" });
  const [explain, setExplain] = useState<ExplainState>({ kind: "idle" });
  const [foresight, setForesight] = useState<ForesightState>({ kind: "idle" });
  const [reorder, setReorder] = useState<ReorderState>({ kind: "loading" });
  // Modal her açıldığında / müşteri değiştiğinde "Özet" sekmesine döner.
  const [activeTab, setActiveTab] = useState<TabId>("ozet");

  // Fetch detail when the modal opens / customer changes.
  useEffect(() => {
    let cancelled = false;
    setSales({ kind: "loading" });
    setExplain({ kind: "idle" });
    setForesight({ kind: "idle" });
    setActiveTab("ozet");
    // Müşteri detayına iniş (harita tıklaması / arama fly-to dahil hepsi bu modalı açar).
    trackInteraction("drilldown", "drilldown:customer");
    getCustomerSales(customer.id, customer.distKod)
      .then((data) => !cancelled && setSales({ kind: "ok", data }))
      .catch((err) => !cancelled && setSales({ kind: "err", message: (err as Error).message }));

    setReorder({ kind: "loading" });
    getCustomerReorder(customer.id, customer.distKod)
      .then((data) => !cancelled && setReorder({ kind: "ok", data }))
      .catch((err) => !cancelled && setReorder({ kind: "err", message: (err as Error).message }));

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
      const ciroStr = Math.round(Number(s.ciro30 ?? 0)).toLocaleString(locale === "en" ? "en-US" : "tr-TR");
      // Prompt gövdesi client-side kuruluyor ve /api/radars/:id/explain'e
      // `question` olarak POST edilir — bu yüzden EN locale'de tamamen
      // İngilizce metinle inşa ediliyor ki Gemini yanıtı da İngilizce dönsün.
      // TBL*/DBL*/LNG* tablo/kolon adları her iki dilde de aynı kalır.
      const question =
        locale === "en"
          ? `Customer "${customer.unvan}" in the Univera ERP (TBLMUSTERI.LNGKOD = ${customer.id}, distributor: ${customer.distributor ?? "—"}, city: ${customer.sehir ?? "—"}). Last 30 days sales revenue is ${ciroStr} ₺ across ${s.fatura30} sales invoices. Visit count: ${s.ziyaret30} (in-route ${s.rutIciZiyaret}, off-route ${s.rutDisiZiyaret}). Derive this customer's last-30-day **product group / brand breakdown** via TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUN + TBLURUNGRUP (TBLMSDFATURA.LNGMUSTERIKOD = ${customer.id} AND BYTTUR=0 AND BYTDURUM=0). If the product group breakdown returns 0 rows (the TBLURUNGRUP join doesn't hold), try at the product level with TBLURUN.TXTAD instead. Give the top 2-3 revenue-generating product groups (or products) with concrete names and amounts. Write a 2-3 sentence executive summary in English.`
          : `Univera ERP'de "${customer.unvan}" adlı müşteri (TBLMUSTERI.LNGKOD = ${customer.id}, distribütör: ${customer.distributor ?? "—"}, şehir: ${customer.sehir ?? "—"}). Son 30 gün satış cirosu ${ciroStr} ₺ ve ${s.fatura30} satış faturası kaydı var. Ziyaret sayısı: ${s.ziyaret30} (rut içi ${s.rutIciZiyaret}, rut dışı ${s.rutDisiZiyaret}). Bu müşterinin son 30 gündeki **ürün grubu / marka kırılımını** TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUN + TBLURUNGRUP üzerinden çıkar (TBLMSDFATURA.LNGMUSTERIKOD = ${customer.id} AND BYTTUR=0 AND BYTDURUM=0). Eğer ürün grubu kırılımı 0 satır verirse (TBLURUNGRUP join'i tutmazsa), ürün-seviyesinde TBLURUN.TXTAD ile dene. En çok ciro getiren 2-3 ürün grubunu (yoksa ürünü) somut adlarıyla, miktarlarıyla ver. 2-3 cümlelik Türkçe yönetici özeti yaz.`;
      const res = await explainOnRadar("sales", question);
      if (!res.brief) {
        setExplain({
          kind: "err",
          message: translate(
            locale,
            "customer.explain.no_response",
            "Agent yanıt üretmedi. Sunucu loglarına bak (en olası: tablo retrieve edilemedi).",
          ),
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
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border">
        <header className="px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight truncate">{customer.unvan}</h2>
            {customer.kisaAd && customer.kisaAd !== customer.unvan && (
              <div className="text-sm text-fg-2 mt-0.5 truncate">{customer.kisaAd}</div>
            )}
            <div className="text-xs text-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {customer.visitOrderRisk ? (
                <VisitOrderRiskBadge vo={customer.visitOrderRisk} locale={locale} />
              ) : (
                <RiskTierBadge tier={customer.riskScore.tier} score={customer.riskScore.score} locale={locale} />
              )}
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
              {customer.musteriKodu && (
                <span className="text-muted-2 font-mono">
                  {translate(locale, "map.filters.code", "Kod")}: {customer.musteriKodu}
                </span>
              )}
            </div>
            {(customer.daysSinceLastSale !== null || customer.daysSinceLastVisit !== null) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                {customer.daysSinceLastSale !== null && (
                  <span>
                    {translate(locale, "customer.last_sale", "Son satış")}:{" "}
                    <span className="text-fg-2 font-medium">
                      {customer.daysSinceLastSale === 0
                        ? translate(locale, "customer.today", "bugün")
                        : translate(locale, "customer.days_ago", "{n} gün önce", { n: customer.daysSinceLastSale })}
                    </span>
                  </span>
                )}
                {customer.daysSinceLastVisit !== null && (
                  <span>
                    {translate(locale, "customer.last_visit", "Son ziyaret")}:{" "}
                    <span className="text-fg-2 font-medium">
                      {customer.daysSinceLastVisit === 0
                        ? translate(locale, "customer.today", "bugün")
                        : translate(locale, "customer.days_ago", "{n} gün önce", { n: customer.daysSinceLastVisit })}
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
            aria-label={translate(locale, "weekly.close_aria", "Kapat")}
          >
            <X size={18} />
          </button>
        </header>
        {sales.kind === "ok" && <TabBar active={activeTab} onChange={setActiveTab} locale={locale} />}
        </div>

        <div className="p-6">
          {sales.kind === "loading" && (
            <div className="text-sm text-muted text-center py-12">
              {translate(locale, "customer.detail_loading", "Müşteri detayı yükleniyor…")}
            </div>
          )}

          {sales.kind === "err" && (
            <div className="rounded-md border border-bad/40 bg-bad/10 p-4 text-sm">
              <div className="font-medium text-bad mb-1">{translate(locale, "customer.detail_error", "Detay alınamadı")}</div>
              <code className="text-xs text-muted">{sales.message}</code>
            </div>
          )}

          {sales.kind === "ok" && (
            <>
              {/* Sekme 1 — Özet: reorder DIŞINDAKİ her şey (Risk Skoru kartı,
                  Son 30 Gün KPI'ları, Tahsilat, Ziyaret Detayı, Sahada Belge,
                  AI Analizi + Öngörü), mevcut sırayla tek panelde. */}
              <TabPanel id="ozet" active={activeTab === "ozet"}>
                {/* Composite Risk Score — başlığın hemen altında öne çıkar.
                    Ödeme bileşeni sync sırasında null geliyor (Univera mirror'da
                    tahsilat snapshot'ı yok); detail fetch ile gelen tahsilat
                    verisinden display-time hesaplıyoruz ve overall score'u
                    yeniden ağırlıklandırıyoruz. */}
                {customer.visitOrderRisk ? (
                  <VisitOrderRiskCard vo={customer.visitOrderRisk} locale={locale} />
                ) : (
                  <RiskScoreCard
                    riskScore={enhanceRiskScoreWithPayment(customer.riskScore, sales.data, locale)}
                    locale={locale}
                  />
                )}

                {/* Top KPI grid */}
                <section>
                  <SectionHeading>{translate(locale, "customer.section.last30_summary", "Son 30 Gün Özet")}</SectionHeading>
                  <div className="grid grid-cols-3 gap-3">
                    <KpiTile
                      label={translate(locale, "komuta.metric.ciro", "Ciro")}
                      value={`${formatCompact(sales.data.ciro30, locale)} ₺`}
                    />
                    <KpiTile
                      label={translate(locale, "customer.invoice", "Fatura")}
                      value={Number(sales.data.fatura30 ?? 0).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
                    />
                    <KpiTile
                      label={translate(locale, "customer.visit", "Ziyaret")}
                      value={Number(sales.data.ziyaret30 ?? 0).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
                    />
                  </div>
                  {(sales.data.sonFaturaTarihi || sales.data.sonZiyaretTarihi) && (
                    <div className="text-xs text-muted mt-3 flex flex-wrap gap-x-4 gap-y-1">
                      {sales.data.sonFaturaTarihi && (
                        <span>
                          {translate(locale, "customer.last_invoice", "Son fatura")}:{" "}
                          <span className="text-fg">
                            {new Date(sales.data.sonFaturaTarihi).toLocaleDateString(locale === "en" ? "en-US" : "tr-TR")}
                          </span>
                        </span>
                      )}
                      {sales.data.sonZiyaretTarihi && (
                        <span>
                          {translate(locale, "customer.last_visit", "Son ziyaret")}:{" "}
                          <span className="text-fg">
                            {new Date(sales.data.sonZiyaretTarihi).toLocaleDateString(locale === "en" ? "en-US" : "tr-TR")}
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </section>

                {/* Tahsilat + Ziyaret Detayı + Sahada Belge — Özet'in devamı
                    (ayrı "Operasyon" sekmesi kaldırıldı, kullanıcı isteğiyle
                    reorder dışındaki her şey tek sekmede birleşti). */}
                {sales.data.tahsilatNakit +
                  sales.data.tahsilatCek +
                  sales.data.tahsilatSenet +
                  sales.data.tahsilatKK +
                  (sales.data.rutIciZiyaret ?? 0) +
                  (sales.data.rutDisiZiyaret ?? 0) +
                  (sales.data.ziyaretFaturaSayisi ?? 0) +
                  (sales.data.ziyaretIrsaliyeSayisi ?? 0) +
                  (sales.data.ziyaretSiparisSayisi ?? 0) ===
                0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-bg/40 p-8 text-center text-sm text-muted">
                    {translate(locale, "customer.tab.operasyon_empty", "Bu müşteri için operasyon verisi yok.")}
                  </div>
                ) : (
                  <>
                    {/* Tahsilat */}
                    <section>
                      <SectionHeading>{translate(locale, "customer.section.collections", "Tahsilat")}</SectionHeading>
                      <div className="grid grid-cols-4 gap-2">
                        <MiniTile label={translate(locale, "customer.cash", "Nakit")} value={`${formatCompact(sales.data.tahsilatNakit, locale)} ₺`} />
                        <MiniTile label={translate(locale, "customer.check", "Çek")} value={`${formatCompact(sales.data.tahsilatCek, locale)} ₺`} />
                        <MiniTile label={translate(locale, "customer.promissory_note", "Senet")} value={`${formatCompact(sales.data.tahsilatSenet, locale)} ₺`} />
                        <MiniTile label={translate(locale, "customer.credit_card", "Kredi K.")} value={`${formatCompact(sales.data.tahsilatKK, locale)} ₺`} />
                      </div>
                      <div className="text-[11px] text-muted mt-2">
                        {translate(locale, "customer.total", "Toplam")}:{" "}
                        <span className="text-fg tabular-nums">
                          {formatCompact(
                            sales.data.tahsilatNakit +
                              sales.data.tahsilatCek +
                              sales.data.tahsilatSenet +
                              sales.data.tahsilatKK,
                            locale,
                          )}{" "}
                          ₺
                        </span>
                      </div>
                    </section>

                    {/* Ziyaret kırılımı */}
                    <section>
                      <SectionHeading>{translate(locale, "customer.section.visit_detail", "Ziyaret Detayı")}</SectionHeading>
                      <div className="grid grid-cols-2 gap-2">
                        <MiniTile
                          label={translate(locale, "customer.in_route_visit", "Rut içi ziyaret")}
                          value={Number(sales.data.rutIciZiyaret ?? 0).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
                        />
                        <MiniTile
                          label={translate(locale, "customer.off_route_visit", "Rut dışı ziyaret")}
                          value={Number(sales.data.rutDisiZiyaret ?? 0).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
                        />
                      </div>
                    </section>

                    {/* Belge sayıları (ziyaret içinde) */}
                    <section>
                      <SectionHeading>{translate(locale, "customer.section.field_documents", "Sahada Belge")}</SectionHeading>
                      <div className="grid grid-cols-3 gap-2">
                        <MiniTile
                          label={translate(locale, "customer.invoice", "Fatura")}
                          value={Number(sales.data.ziyaretFaturaSayisi ?? 0).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
                        />
                        <MiniTile
                          label={translate(locale, "customer.waybill", "İrsaliye")}
                          value={Number(sales.data.ziyaretIrsaliyeSayisi ?? 0).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
                        />
                        <MiniTile
                          label={translate(locale, "customer.order", "Sipariş")}
                          value={Number(sales.data.ziyaretSiparisSayisi ?? 0).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
                        />
                      </div>
                    </section>
                  </>
                )}

                {/* AI Analizi + Öngörü — Özet'in devamı (ayrı "AI & Öngörü"
                    sekmesi kaldırıldı, butonlar + sonuç render'ları buraya
                    taşındı). */}
                <section className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={runExplain}
                      loading={explain.kind === "loading"}
                      iconLeft={explain.kind !== "loading" ? <Sparkles size={15} /> : undefined}
                    >
                      {explain.kind === "loading" ? (
                        translate(locale, "customer.ai.analyzing", "Analiz ediliyor…")
                      ) : (
                        <>
                          {translate(locale, "customer.ai.get_analysis", "AI Analizi al")}
                          <span title={translate(locale, "komuta.fa.paid_content", "Ücretli içerik")} className="ml-1.5 text-[11px] font-bold px-1 rounded border border-current opacity-90">$</span>
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => runForesight()}
                      loading={foresight.kind === "loading"}
                      iconLeft={foresight.kind !== "loading" ? <Target size={15} /> : undefined}
                      className="border-accent/40 text-accent hover:bg-[var(--color-accent-soft)]"
                    >
                      {foresight.kind === "loading" ? (
                        translate(locale, "customer.foresight.extracting", "Öngörü çıkarılıyor…")
                      ) : (
                        <>
                          {translate(locale, "customer.foresight.get", "Öngörü al (14 gün)")}
                          <span title={translate(locale, "komuta.fa.paid_content", "Ücretli içerik")} className="ml-1.5 text-[11px] font-bold px-1 rounded border border-current opacity-90">$</span>
                        </>
                      )}
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
                        <Sparkles size={11} /> {translate(locale, "customer.ai.analysis", "AI Analizi")}
                      </CardHeader>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">
                        {explain.brief}
                      </div>
                      {explain.sql && (
                        <details className="mt-3">
                          <summary className="text-xs text-muted cursor-pointer hover:text-fg">
                            {translate(locale, "customer.ai.sql_used", "Kullanılan SQL")}
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
              </TabPanel>

              {/* Sekme 2 — Sipariş Önerisi (mevcut kompakt ReorderSuggestions, AYNEN). */}
              <TabPanel id="oneri" active={activeTab === "oneri"}>
                <section>
                  <SectionHeading>{translate(locale, "customer.section.reorder", "Sipariş Önerisi")}</SectionHeading>
                  {reorder.kind === "loading" && (
                    <div className="text-sm text-muted text-center py-6">
                      {translate(locale, "customer.reorder.loading", "Sipariş önerileri yükleniyor…")}
                    </div>
                  )}
                  {reorder.kind === "err" && (
                    <div className="rounded-md border border-bad/40 bg-bad/10 p-4 text-sm">
                      <div className="font-medium text-bad mb-1">{translate(locale, "customer.reorder.error", "Sipariş önerisi alınamadı")}</div>
                      <code className="text-xs text-muted">{reorder.message}</code>
                    </div>
                  )}
                  {reorder.kind === "ok" && <ReorderSuggestions data={reorder.data} locale={locale} />}
                </section>
              </TabPanel>
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
              locale={locale}
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

// ---------------------------------------------------------------------------
// Sipariş Önerisi — miktar kasten yok (satışçı girer), sadece hangi ürün /
// ne zaman sinyali.
// ---------------------------------------------------------------------------

/**
 * v2 — kapsam açığı: "hic-almadi" akranların içindeki en acil boşluk olduğu
 * için her zaman "akran-alti" öğelerinden önce gelir; her iki alt-küme kendi
 * içinde `oncelikSkoru` düşene göre sıralanır (backend'in ürettiği sıra
 * korunmaz — skor UI'nın sorumluluğunda tazelenir).
 */
function sortWalletGap(items: WalletGapItem[]): WalletGapItem[] {
  const rank = (t: WalletGapItem["tur"]) => (t === "hic-almadi" ? 0 : 1);
  return [...items].sort((a, b) => rank(a.tur) - rank(b.tur) || b.oncelikSkoru - a.oncelikSkoru);
}

function sortByPriority<T extends { oncelikSkoru: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.oncelikSkoru - a.oncelikSkoru);
}

function ReorderSuggestions({ data, locale = "tr" }: { data: ReorderResult; locale?: Locale }) {
  const gapItems = sortWalletGap(data.walletGap ?? []);
  // v2 peer-temelli çapraz-satış varsa v1'in yerini alır (aynı bölüm, daha
  // anlamlı gerekçe); yoksa geriye-uyum için v1 `crossSell` gösterilmeye devam eder.
  const peerCrossItems = data.peerCrossSell ? sortByPriority(data.peerCrossSell) : null;

  const summaryEntries: { count: number; label: string }[] = [
    { count: data.ozet.toplamGecikmis, label: translate(locale, "customer.reorder.overdue_count", "gecikmiş") },
    { count: data.ozet.toplamWinback, label: translate(locale, "customer.reorder.dropped_count", "bırakılmış") },
    { count: data.ozet.toplamCross, label: translate(locale, "customer.reorder.suggestion_count", "öneri") },
  ];
  if (typeof data.ozet.gapSayi === "number") {
    summaryEntries.push({ count: data.ozet.gapSayi, label: translate(locale, "customer.reorder.gap_count", "kapsam açığı") });
  }
  if (typeof data.ozet.peerCrossSayi === "number") {
    summaryEntries.push({ count: data.ozet.peerCrossSayi, label: translate(locale, "customer.reorder.peer_cross_count", "akran önerisi") });
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted">
        {summaryEntries.map((entry, i) => (
          <span key={entry.label}>
            {i > 0 && " · "}
            <span className="text-fg-2 font-medium">{entry.count}</span> {entry.label}
          </span>
        ))}
      </div>

      <ReorderGroup
        title={translate(locale, "customer.reorder.overdue_title", "Gecikmiş siparişler")}
        titleTone="text-bad"
        items={data.overdue}
        emptyText={translate(locale, "customer.reorder.overdue_empty", "gecikmiş sipariş yok")}
        keyOf={(o) => o.urunKod}
        locale={locale}
        renderItem={(o) => (
          <BarRow
            name={o.urunAd}
            valueText={translate(locale, "customer.reorder.overdue_days", "{n} gün gecikti", { n: o.gunGecikti })}
            valueTone="text-bad"
            meta={translate(locale, "customer.reorder.overdue_meta", "{count} sipariş · ort {days}g", {
              count: o.siparisSayisi,
              days: o.ortAralikGun,
            })}
          />
        )}
      />

      <ReorderGroup
        title={translate(locale, "customer.reorder.dropped_title", "Bırakılan ürünler")}
        titleTone="text-warn"
        items={data.winBack}
        emptyText={translate(locale, "customer.reorder.dropped_empty", "bırakılmış ürün yok")}
        keyOf={(w) => w.urunKod}
        locale={locale}
        renderItem={(w) => (
          <BarRow
            name={w.urunAd}
            valueText={translate(locale, "customer.reorder.dropped_days", "{n} gündür sipariş yok", { n: w.gunGecti })}
            valueTone="text-warn"
          />
        )}
      />

      {/* v2 — kapsam açığı: alan gelmezse (backend henüz üretmiyorsa) ya da
          boşsa bölüm hiç render edilmez. "hiç almadı" = FIRSAT (yeşil) — akranın
          çoğunun aldığı, bu müşterinin hiç dokunmadığı en büyük boşluk; kırmızı
          "risk" çağrışımı YANLIŞ olur. "akran altı" nötr/muted — zaten alıyor,
          sadece ortalamanın altında. */}
      {gapItems.length > 0 && (
        <ReorderGroup
          title={translate(locale, "customer.reorder.gap_title", "Kapsam Açığı")}
          titleTone="text-accent"
          items={gapItems}
          emptyText={translate(locale, "customer.reorder.gap_empty", "kapsam açığı yok")}
          keyOf={(g) => g.urunGrupKod}
          locale={locale}
          renderItem={(g) => (
            <BarRow
              name={g.urunGrupAd}
              pct={g.peerPenetrasyon}
              barTone={g.tur === "hic-almadi" ? "bg-good/70" : "bg-muted-2/60"}
              valueText={`%${g.peerPenetrasyon.toFixed(0)}`}
              badge={
                g.tur === "hic-almadi" ? (
                  <Badge tone="good" size="sm">
                    {translate(locale, "customer.reorder.gap_tur_none", "fırsat")}
                  </Badge>
                ) : (
                  <Badge tone="muted" size="sm">
                    {translate(locale, "customer.reorder.gap_tur_below", "akran altı")}
                  </Badge>
                )
              }
              meta={translate(locale, "customer.reorder.gap_meta", "{count} akran", {
                count: formatCompact(g.peerMusteriSayi, locale),
              })}
              title={translate(
                locale,
                g.tur === "hic-almadi" ? "customer.reorder.gap_none_desc" : "customer.reorder.gap_below_desc",
                g.tur === "hic-almadi"
                  ? "Akranlarının %{pct}'i {grup} alıyor — bu müşteri hiç almıyor."
                  : "Akranlarının %{pct}'i {grup} alıyor — bu müşteri az alıyor.",
                { pct: g.peerPenetrasyon.toFixed(0), grup: g.urunGrupAd },
              )}
            />
          )}
        />
      )}

      <ReorderGroup<PeerCrossSellItem | ReorderCrossSellItem>
        title={translate(locale, "customer.reorder.cross_sell_title", "Çapraz-satış önerisi")}
        titleTone="text-muted"
        items={peerCrossItems ?? data.crossSell}
        emptyText={translate(locale, "customer.reorder.cross_sell_empty", "öneri yok")}
        keyOf={(c) => c.urunKod}
        locale={locale}
        renderItem={(c) =>
          peerCrossItems ? (
            <PeerCrossSellRow item={c as PeerCrossSellItem} locale={locale} />
          ) : (
            <CrossSellRow item={c as ReorderCrossSellItem} locale={locale} />
          )
        }
      />
    </div>
  );
}

/**
 * Kompakt tek-satır satır — panelin genelindeki "isim · bar · değer" bar-satır
 * desenine uyar (bkz. `v3/marka/BrandPortfolioPanel.tsx`). `pct` verilmezse
 * (v1 overdue/winBack gibi peer-yüzdesi olmayan veriler) bar hiç render
 * edilmez — sahte bir oran icat edilmez.
 */
function BarRow({
  name,
  pct,
  barTone = "bg-good/70",
  valueText,
  valueTone = "text-fg-2",
  badge,
  meta,
  subline,
  title,
}: {
  name: string;
  pct?: number;
  barTone?: string;
  valueText: string;
  valueTone?: string;
  badge?: React.ReactNode;
  meta?: string;
  /** İkinci satır — tam genişlik, kırpılmaz (çapraz-satışta "birlikte alınan
   *  ürün" gerekçesi burada okunur şekilde gösterilir). */
  subline?: React.ReactNode;
  title?: string;
}) {
  return (
    <li className="flex flex-col px-2.5 py-1.5 hover:bg-surface-2/60 transition-colors" title={title}>
      <div className="flex items-center gap-2.5 w-full">
        <span className="text-sm truncate flex-1 min-w-0">{name}</span>
        {pct !== undefined && (
          <div className="w-16 h-1.5 rounded-full bg-bg overflow-hidden shrink-0" aria-hidden="true">
            <div
              className={"h-full rounded-full transition-[width] duration-300 " + barTone}
              style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
            />
          </div>
        )}
        <span className={"text-xs font-semibold tabular-nums shrink-0 whitespace-nowrap " + valueTone}>
          {valueText}
        </span>
        {badge}
        {meta && (
          <span className="text-[10px] text-muted shrink-0 truncate max-w-[120px]">{meta}</span>
        )}
      </div>
      {subline && (
        <div className="text-[11px] text-muted leading-snug mt-0.5">{subline}</div>
      )}
    </li>
  );
}

function CrossSellRow({ item, locale }: { item: ReorderCrossSellItem; locale: Locale }) {
  return (
    <BarRow
      name={item.urunAd}
      valueText={translate(locale, "customer.reorder.cross_sell_count", "{n}×", { n: item.birlikteSayisi })}
      badge={
        <Badge tone="muted" size="sm">
          {translate(locale, "customer.reorder.cross_sell_badge", "öneri")}
        </Badge>
      }
      subline={
        item.anchorUrunAd
          ? translate(
              locale,
              "customer.reorder.cross_sell_subline",
              "🔗 {anchor} alan müşteriler bunu da alıyor",
              { anchor: item.anchorUrunAd },
            )
          : undefined
      }
    />
  );
}

/**
 * v2 — peer-temelli çapraz-satış satırı. Akranların büyük kısmının aldığı,
 * bu müşterinin henüz almadığı ürün her zaman bir FIRSAT'tır (yeşil) —
 * `WalletGapItem` "hic-almadi" ile aynı anlam ailesinde. `anchorUrunAd`
 * mevcutsa (backend somut bir "birlikte alınan ürün" ile destekleyebiliyorsa)
 * v1'in daha spesifik gerekçesi meta alanında kısaca korunur; yoksa akran
 * sayısı gösterilir.
 */
function PeerCrossSellRow({ item, locale }: { item: PeerCrossSellItem; locale: Locale }) {
  // Alt satır: somut "birlikte alınan ürün" varsa onu, yoksa akran-penetrasyon
  // gerekçesini TAM ve okunur göster (kırpma yok).
  const subline = item.anchorUrunAd
    ? translate(
        locale,
        "customer.reorder.cross_sell_subline",
        "🔗 {anchor} alan müşteriler bunu da alıyor",
        { anchor: item.anchorUrunAd },
      )
    : translate(
        locale,
        "customer.reorder.peer_cross_subline",
        "🔗 Senin gibi {count} müşterinin %{pct}'i bunu alıyor",
        { pct: item.peerPenetrasyon.toFixed(0), count: formatCompact(item.peerMusteriSayi, locale) },
      );
  return (
    <BarRow
      name={item.urunAd}
      pct={item.peerPenetrasyon}
      barTone="bg-good/70"
      valueText={`%${item.peerPenetrasyon.toFixed(0)}`}
      badge={
        <Badge tone="good" size="sm">
          {translate(locale, "customer.reorder.gap_tur_none", "fırsat")}
        </Badge>
      }
      subline={subline}
    />
  );
}

const REORDER_GROUP_TOP_N = 4;

function ReorderGroup<T>({
  title,
  titleTone,
  items,
  emptyText,
  keyOf,
  renderItem,
  locale,
}: {
  title: string;
  titleTone: string;
  items: T[];
  emptyText: string;
  keyOf: (item: T) => React.Key;
  renderItem: (item: T) => React.ReactNode;
  locale: Locale;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, REORDER_GROUP_TOP_N);
  const hiddenCount = items.length - REORDER_GROUP_TOP_N;

  return (
    <div>
      <div className={"text-[10px] uppercase tracking-wider font-semibold mb-1.5 " + titleTone}>
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted">{emptyText}</div>
      ) : (
        <>
          <ul className="rounded-md border border-border bg-surface divide-y divide-border/50 overflow-hidden">
            {visibleItems.map((item) => (
              <Fragment key={keyOf(item)}>{renderItem(item)}</Fragment>
            ))}
          </ul>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              className="mt-1.5 text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 rounded-sm"
            >
              {expanded
                ? translate(locale, "customer.reorder.show_less", "daha az göster")
                : translate(locale, "customer.reorder.show_more", "+{n} daha", { n: hiddenCount })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function formatCompact(n: number, locale: Locale = "tr"): string {
  if (typeof n !== "number" || isNaN(n)) return "—";
  const intl = locale === "en" ? "en-US" : "tr-TR";
  const suffixBillion = locale === "en" ? "Bn" : "Mr";
  if (Math.abs(n) >= 1_000_000_000)
    return (n / 1_000_000_000).toLocaleString(intl, { maximumFractionDigits: 2 }) + " " + suffixBillion;
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toLocaleString(intl, { maximumFractionDigits: 2 }) + " Mn";
  return n.toLocaleString(intl, { maximumFractionDigits: 0 });
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

/** Tier anahtarı → i18n key. Stil/renk bilgisi TIER_STYLES'ta kalır; sadece
 *  görünen etiket burada locale'e göre çözülür. */
const TIER_LABEL_KEYS: Record<MapCustomer["riskScore"]["tier"], string> = {
  critical: "customer.tier.critical",
  risk: "customer.tier.risk",
  watch: "customer.tier.watch",
  healthy: "customer.tier.healthy",
  unknown: "customer.tier.unknown",
};

function tierLabel(tier: MapCustomer["riskScore"]["tier"], locale: Locale): string {
  return translate(locale, TIER_LABEL_KEYS[tier], TIER_STYLES[tier].label);
}

function RiskTierBadge({
  tier,
  score,
  locale = "tr",
}: {
  tier: MapCustomer["riskScore"]["tier"];
  score: number | null;
  locale?: Locale;
}) {
  const s = TIER_STYLES[tier];
  const label = tierLabel(tier, locale);
  return (
    <Badge tone={s.badgeTone} size="sm" dot>
      {score !== null ? `${score}/100 · ${label}` : label}
    </Badge>
  );
}

// --- Visit-order risk (Wietnauer "visit-order" modeli) -----------------------
// Tier → composite stil anahtarı (renk/rozet tonunu yeniden kullanmak için).
const VO_TIER_TO_COMPOSITE: Record<"red" | "orange" | "yellow" | "green", MapCustomer["riskScore"]["tier"]> = {
  red: "critical",
  orange: "risk",
  yellow: "watch",
  green: "healthy",
};
const VO_TIER_LABEL: Record<"red" | "orange" | "yellow" | "green", string> = {
  red: "Kritik",
  orange: "Riskli",
  yellow: "İzlenmeli",
  green: "Sağlıklı",
};

/** Tier'dan yerel-doğru gerekçe: tier ziyaret/sipariş ikili durumunu KODLAR
 *  (red=ikisi yok, orange=ziyaret yok+sipariş var, yellow=ziyaret var+sipariş
 *  yok, green=ikisi var) — backend'in TR-only `reason`'ı yerine buradan üretilir. */
function voReason(tier: "red" | "orange" | "yellow" | "green", locale: Locale): string {
  const noVisit = tier === "red" || tier === "orange";
  const noOrder = tier === "red" || tier === "yellow";
  const zi = noVisit
    ? translate(locale, "customer.vo.novisit", "Ziyaret yok")
    : translate(locale, "customer.vo.visit", "Ziyaret var");
  const si = noOrder
    ? translate(locale, "customer.vo.noorder", "Sipariş yok")
    : translate(locale, "customer.vo.order", "Sipariş var");
  return `${zi} · ${si}`;
}

function VisitOrderRiskBadge({
  vo,
  locale = "tr",
}: {
  vo: NonNullable<MapCustomer["visitOrderRisk"]>;
  locale?: Locale;
}) {
  const s = TIER_STYLES[VO_TIER_TO_COMPOSITE[vo.tier]];
  const label = translate(locale, `customer.votier.${vo.tier}`, VO_TIER_LABEL[vo.tier]);
  return (
    <Badge tone={s.badgeTone} size="sm" dot>
      {label}
    </Badge>
  );
}

function VisitOrderRiskCard({
  vo,
  locale = "tr",
}: {
  vo: NonNullable<MapCustomer["visitOrderRisk"]>;
  locale?: Locale;
}) {
  const s = TIER_STYLES[VO_TIER_TO_COMPOSITE[vo.tier]];
  const label = translate(locale, `customer.votier.${vo.tier}`, VO_TIER_LABEL[vo.tier]);
  return (
    <div className={`rounded-lg border ${s.borderCls} ${s.softCls} px-4 py-3 mb-4`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`size-2.5 rounded-full ${s.barCls}`} aria-hidden="true" />
          <span className={`text-base font-semibold ${s.textCls}`}>{label}</span>
        </div>
        <span className="text-[11px] text-muted uppercase tracking-wide">
          {translate(locale, "customer.vo.model", "Ziyaret + Sipariş Riski")}
        </span>
      </div>
      <div className="text-sm text-fg-2 mt-2 font-medium">{voReason(vo.tier, locale)}</div>
      <div className="text-[11px] text-muted mt-1 leading-snug">
        {translate(
          locale,
          "customer.vo.hint",
          "Risk seçili dönemde müşterinin ziyaret edilip edilmediğine ve sipariş verip vermediğine göre belirlenir.",
        )}
      </div>
    </div>
  );
}

const COMPONENT_LABEL_KEYS: Record<
  keyof MapCustomer["riskScore"]["components"],
  string
> = {
  momentum: "customer.component.momentum",
  behavioral: "customer.component.behavioral",
  payment: "customer.component.payment",
  engagement: "customer.component.engagement",
};

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
  locale = "tr",
}: {
  riskScore: MapCustomer["riskScore"];
  locale?: Locale;
}) {
  const s = TIER_STYLES[riskScore.tier];
  const label = tierLabel(riskScore.tier, locale);
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
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold flex items-center">
            {translate(locale, "customer.risk_score", "Risk Skoru")}
            <InfoHint
              title={translate(locale, "customer.risk_hint.title", "Risk skoru nasıl hesaplanıyor?")}
              source={translate(
                locale,
                "customer.risk_hint.source",
                "Bileşik risk skoru — sync anında hesaplanır (0–100, yüksek = yüksek risk)",
              )}
              window={translate(locale, "customer.risk_hint.window", "Son 30 / 90 gün + geçen yıl aynı 30 gün (YoY)")}
              base={translate(locale, "customer.risk_hint.base", "4 bileşenin ağırlıklı toplamı")}
              notes={[
                translate(
                  locale,
                  "customer.risk_hint.note1",
                  "Satış Momentumu %40 — ciro ivmesi: son 30g vs önceki 30g (%45), 90g aylık baseline (%35) ve geçen yıl aynı dönem (%20); uzun sessizlik düşüşü büyütür (×1.5'e kadar).",
                ),
                translate(
                  locale,
                  "customer.risk_hint.note2",
                  "Davranışsal %30 — sessizlik: son siparişten bu yana geçen gün (%50, ana sinyal) + sipariş sıklığı düşüşü (%30, fatura sayısı) + sepet daralması (%20, distinct ürün grubu).",
                ),
                translate(
                  locale,
                  "customer.risk_hint.note3",
                  "Ödeme %20 — bu ekranda görüntülenirken tahsilat verisinden anlık hesaplanır: son 30g tahsilat/ciro karşılama oranı + çek/senet (vade) payı cezası.",
                ),
                translate(
                  locale,
                  "customer.risk_hint.note4",
                  "Etkileşim %10 — ziyaret cadence'i: son 90g ziyaret sıklığına göre beklenen aralık (15/30/60 gün) ile son ziyaretten bu yana geçen süre kıyaslanır.",
                ),
                translate(locale, "customer.risk_hint.note5", "Tier eşikleri: 0–29 sağlıklı · 30–54 izlemede · 55–74 riskli · 75+ kritik."),
                translate(
                  locale,
                  "customer.risk_hint.note6",
                  "Baz ciro < 1.000 TL ise ilgili sinyal 'yok' sayılır — yeni/dormant müşteri skoru bozmaz. Hiçbir bileşen hesaplanamazsa tier 'Yetersiz veri' olur.",
                ),
              ]}
            />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={"text-3xl font-bold tracking-tight tabular-nums " + s.textCls}
            >
              {riskScore.score !== null ? riskScore.score : "—"}
            </span>
            <span className="text-sm text-muted">/100</span>
            <span className={"text-sm font-semibold " + s.textCls}>· {label}</span>
          </div>
        </div>
        <div className="text-[10px] text-muted-2 text-right leading-tight max-w-[180px]">
          {translate(locale, "customer.risk_composite_desc", "Satış, davranış, ödeme ve etkileşim sinyallerinin bileşik skoru.")}
        </div>
      </div>

      {/* Bileşen barları */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {(Object.keys(COMPONENT_LABELS) as Array<keyof typeof COMPONENT_LABELS>).map(
          (key) => (
            <ComponentBar
              key={key}
              label={translate(locale, COMPONENT_LABEL_KEYS[key], COMPONENT_LABELS[key])}
              locale={locale}
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
  locale = "tr",
}: {
  label: string;
  value: number | null;
  locale?: Locale;
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
          {value === null ? translate(locale, "map.risk.no_data", "veri yok") : Math.round(value)}
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
  locale = "tr",
}: {
  data: ForesightResult;
  customer: MapCustomer;
  onRefresh?: () => void;
  locale?: Locale;
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
      reason: translate(locale, "customer.foresight.weekly_action_reason", "14 günlük müşteri foresight"),
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
            {translate(locale, "customer.foresight.eyebrow", "Foresight · sonraki 14 gün")}
          </div>
          <div className="text-xl font-semibold tracking-tight mt-1">
            {customer.unvan}
          </div>
          <div className="text-[10px] text-muted tabular-nums mt-1">
            {translate(locale, "komuta.fa.generated_at", "Üretildi")}:{" "}
            {new Date(data.generatedAt).toLocaleString(locale === "en" ? "en-US" : "tr-TR")}
          </div>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-xs rounded-md border border-border bg-surface text-fg-2 hover:text-fg hover:bg-surface-2 transition-colors"
            title={translate(locale, "customer.foresight.refresh_hint", "Cache'i atlat ve MSSQL'den taze çek")}
          >
            <RefreshCw size={12} />
            {translate(locale, "komuta.fa.refresh", "Yenile")}
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <DashKpi
          icon={<AlertCircle size={14} />}
          label={translate(locale, "customer.foresight.kpi.risk_alert", "Risk uyarısı")}
          value={data.riskFlags.length}
          tone={data.riskFlags.length > 0 ? "bad" : "muted"}
        />
        <DashKpi
          icon={<Calendar size={14} />}
          label={translate(locale, "customer.foresight.kpi.upcoming_event", "Yaklaşan olay (14g)")}
          value={data.events.length}
          tone={data.events.length > 0 ? "accent" : "muted"}
        />
        <DashKpi
          icon={<TrendingDown size={14} />}
          label={translate(locale, "customer.foresight.kpi.dropped_category", "Bıraktığı kategori")}
          value={data.dropped.length}
          tone={data.dropped.length > 0 ? "warn" : "muted"}
        />
        <DashKpi
          icon={<Users size={14} />}
          label={translate(locale, "customer.foresight.kpi.cohort_bought", "Benzerinin aldığı")}
          value={data.cohort.length}
          tone={data.cohort.length > 0 ? "accent" : "muted"}
        />
      </div>

      {/* Risk banner — kept here for prominence even though inline panel had it */}
      {data.riskFlags.length > 0 && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-bad">
            <span className="size-2 rounded-full bg-bad animate-pulse" />
            {translate(locale, "customer.foresight.high_priority_risk", "Yüksek öncelikli risk")}
          </div>
          <ul className="space-y-1.5">
            {data.riskFlags.map((r, i) => (
              <li key={i} className="text-sm leading-snug">
                <span className="font-medium">{r.urunGrubu}</span> —{" "}
                {translate(
                  locale,
                  "customer.foresight.risk_flag_desc",
                  "eskiden {amount} ₺ alıyordu, {days} gündür hiç sipariş yok",
                  {
                    amount: Math.round(r.baselineCiro).toLocaleString(locale === "en" ? "en-US" : "tr-TR"),
                    days: r.daysSinceLast ?? "?",
                  },
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Brief */}
      {data.brief && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
            {translate(locale, "customer.foresight.exec_brief", "Yönetici brifi")}
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
            {translate(locale, "customer.foresight.this_week", "Bu hafta yapılacak")}
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
                        ? translate(locale, "customer.foresight.action_added_aria", "Bu aksiyon haftalık listeye eklendi")
                        : translate(locale, "customer.foresight.action_add_aria", "Aksiyonu haftalık listeye ekle")
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
                        {translate(locale, "komuta.fa.added_label_plain", "Eklendi")}
                      </>
                    ) : (
                      <>
                        <Plus size={12} />
                        {translate(locale, "customer.foresight.add_to_todo", "Yapılacaklar'a ekle")}
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
            {translate(locale, "customer.foresight.calendar_title", "Takvim · sonraki 14 gün")}
          </div>
          <ol className="space-y-2">
            {data.events.map((e, i) => (
              <li key={i} className="flex gap-3 items-start">
                <div className="shrink-0 w-14 text-center">
                  <div className="text-[10px] text-muted leading-tight">
                    T+{e.daysAhead}{translate(locale, "map.day_suffix", "g")}
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
              {translate(locale, "customer.foresight.yoy_title", "Geçen yıl bu hafta · en üst kalemler")}
            </div>
            <div className="text-xs text-muted">
              {translate(locale, "customer.total", "Toplam")}:{" "}
              <span className="text-fg font-medium tabular-nums">
                {Math.round(yoyTotal).toLocaleString(locale === "en" ? "en-US" : "tr-TR")} ₺
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
                    <span className="truncate pr-2">{y.urunGrubu ?? translate(locale, "customer.foresight.no_group", "(grup yok)")}</span>
                    <span className="tabular-nums shrink-0 text-muted">
                      <span className="text-fg font-medium">
                        {Math.round(y.ciro).toLocaleString(locale === "en" ? "en-US" : "tr-TR")} ₺
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
            {translate(locale, "customer.foresight.dropped_title", "Düşmüş kategoriler · re-engagement")}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted text-[10px] uppercase tracking-wider border-b border-border">
                  <th className="text-left font-medium pb-2 pr-2">{translate(locale, "customer.foresight.col_category", "Kategori")}</th>
                  <th className="text-left font-medium pb-2 px-2">{translate(locale, "customer.foresight.col_priority", "Öncelik")}</th>
                  <th className="text-right font-medium pb-2 px-2">{translate(locale, "customer.foresight.col_past_revenue", "Geçmiş ciro")}</th>
                  <th className="text-right font-medium pb-2 pl-2">{translate(locale, "customer.foresight.col_last_order", "Son sipariş")}</th>
                </tr>
              </thead>
              <tbody>
                {data.dropped.slice(0, 8).map((d, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-2 truncate max-w-[200px]">{d.urunGrubu}</td>
                    <td className="py-2 px-2">
                      <UrgencyBadge urgency={d.urgency} locale={locale} />
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {Math.round(d.baselineCiro).toLocaleString(locale === "en" ? "en-US" : "tr-TR")} ₺
                    </td>
                    <td className="py-2 pl-2 text-right tabular-nums text-muted">
                      {d.daysSinceLast ?? "?"} {translate(locale, "customer.days", "gün")}
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
            {translate(locale, "customer.foresight.cohort_title", "Segment kıyası · aldı, bu hesap almadı")}
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
            {translate(locale, "customer.foresight.no_signal", "Önümüzdeki 14 günde bu müşteri için anlamlı bir sinyal yok.")}
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

function UrgencyBadge({ urgency, locale = "tr" }: { urgency: "high" | "medium" | "low"; locale?: Locale }) {
  if (urgency === "high") {
    return (
      <span className="inline-block text-[9px] uppercase tracking-wider font-bold text-bad bg-bad/15 border border-bad/30 px-1 rounded">
        {translate(locale, "customer.urgency.high", "Yüksek")}
      </span>
    );
  }
  if (urgency === "medium") {
    return (
      <span className="inline-block text-[9px] uppercase tracking-wider font-bold text-warn bg-warn/15 border border-warn/30 px-1 rounded">
        {translate(locale, "customer.urgency.medium", "Orta")}
      </span>
    );
  }
  return (
    <span className="inline-block text-[9px] uppercase tracking-wider font-bold text-muted bg-muted/15 border border-muted/30 px-1 rounded">
      {translate(locale, "customer.urgency.low", "Düşük")}
    </span>
  );
}
