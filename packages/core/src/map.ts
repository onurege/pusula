import { runReadOnly } from "./db.js";
import { sqlNow } from "./now.js";
import { cachedClear, withCache } from "./cache.js";
import { getLocalDb } from "./local-db.js";
import { canonicalProvince, loadRegionMaster, normalizeProvince } from "./tr-regions.js";
import { getTenantConfig } from "./tenant/index.js";
import { distFilterClause, type TenantScope } from "./auth.js";

/**
 * `allowedDistKods` (null → merkez, dizi → dist scope) SQLite `dist_kod`
 * kolonuna güvenli IN(...) filtresine çevirir. Sayı dizisi olduğu için
 * `.join(",")` injection riski taşımaz (Number.isInteger guard'lı).
 */
function sqliteDistFilter(allowedDistKods: number[] | null | undefined): string {
  if (allowedDistKods == null) return "";
  const ids = allowedDistKods.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return " AND 1=0";
  return ` AND dist_kod IN (${ids.join(",")})`;
}

/** MSSQL tarafı için TenantScope + distFilterClause üretir — komuta/wietnauer
 *  ile aynı desen. */
function scopeFromAllowed(allowedDistKods: number[] | null | undefined): TenantScope {
  return allowedDistKods == null
    ? { type: "merkez", distKods: null }
    : { type: "dist", distKods: allowedDistKods.filter((n) => Number.isInteger(n)) };
}

/**
 * TR il adını UPPER + ASCII (diacritic-strip) formuna normalize eden SQL
 * expression — case + diacritic-insensitive eşleştirme için. SQLite native
 * Turkish collation yok, manuel REPLACE zinciri yapıyoruz.
 *
 * Kullanım: `${SEHIR_NORM_SQL("sehir")} = ${SEHIR_NORM_SQL("@sehir")}`
 * "İZMİR", "İzmir", "IZMIR", "izmir" hepsi "IZMIR"'e indirgenir → eşleşir.
 *
 * Pernod (TBLMUSTERI'den "İZMİR" upper Turkish) + FMCG demo (seed'de "İzmir"
 * canonical) + olası karışık state'ler tek noktadan tutarlı.
 */
function SEHIR_NORM_SQL(expr: string): string {
  return (
    `UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${expr},` +
    `'İ','I'),'ı','I'),'Ş','S'),'ş','S'),'Ğ','G'),'ğ','G'),'Ü','U'),'ü','U'))`
  );
}

export type RiskTier = "high" | "medium" | "low" | "active";

export type MapCustomer = {
  id: number;
  distKod: number | null;
  unvan: string;
  kisaAd: string | null;
  adres: string | null;
  sehir: string | null;
  ilce: string | null;
  distributor: string | null;
  /** Bölge — TBLDISTGRUP.TXTAD üzerinden distribütörden türetilir. Sync
   *  sırasında doldurulur; region-bazlı harita görünümünde kullanılır. */
  bolge: string | null;
  lat: number;
  lng: number;
  /** True if this customer has at least one approved sales invoice in the
   *  last 30 days. Used both for the activity filter and for marker tone. */
  hasSales: boolean;
  /** Days since most recent approved sales invoice. NULL = never bought. */
  daysSinceLastSale: number | null;
  /** Days since most recent recorded visit. NULL = never visited. */
  daysSinceLastVisit: number | null;
  /** 30-day ciro and the prior 30-day ciro — feed momentum view. */
  ciro30: number;
  ciroPrev30: number;
  /** @deprecated Tek-tier eski model. Yeni UI `riskScore.tier` kullanır.
   *  Sync hâlâ doldurur; geriye dönük uyumluluk için bir süre kalır. */
  riskTier: RiskTier;
  /** Composite Risk Score (0..100) + bileşen kırılımı + sebepler.
   *  Sync zamanı `computeCustomerRiskScore` ile hesaplanır. */
  riskScore: CustomerRiskScore;
};

/**
 * Derives a risk tier from activity recency and ciro momentum.
 *
 * Tier coverage is exhaustive — every {dSale, dVisit, ciro30, ciroPrev30}
 * combination falls into exactly one tier so no customer ends up gray just
 * because the thresholds had gaps. Earlier version had a dead zone in days
 * 15-29 (not active enough for green, not late enough for amber) which
 * dumped the majority of customers into "low" by accident.
 *
 * Thresholds are tuned for Univera distribütör scale where 500-5k ₺/ay is
 * a normal small müşteri and ≥10k starts to count as a meaningful account.
 */
export function computeRiskTier(input: {
  daysSinceLastSale: number | null;
  daysSinceLastVisit: number | null;
  ciro30: number;
  ciroPrev30: number;
}): RiskTier {
  const { daysSinceLastSale: dSale, daysSinceLastVisit: dVisit, ciro30, ciroPrev30 } = input;
  const hasAnyHistory = ciro30 > 0 || ciroPrev30 > 0 || (dSale !== null && dSale < 365);

  // Never engaged or very old single buy → dormant (not "at risk", just gray)
  if (dSale === null || dSale >= 180) return "low";

  // HIGH RISK — relationship is bleeding
  // (a) silent ≥60 days on any account with history
  if (dSale >= 60 && hasAnyHistory) return "high";
  // (b) silent ≥30 days on a meaningful account (≥10k prev 30d ciro)
  if (dSale >= 30 && ciroPrev30 >= 10_000) return "high";
  // (c) momentum collapse: ≥50% drop 30d vs prev 30d, on non-trivial baseline
  if (ciroPrev30 >= 5_000 && ciro30 < ciroPrev30 * 0.5) return "high";

  // MEDIUM — early warning
  // (a) silent 30-59 days on any buying customer
  if (dSale >= 30 && hasAnyHistory) return "medium";
  // (b) long visit gap (60+ days) on a customer that does buy
  if ((dVisit ?? 999) >= 60 && hasAnyHistory) return "medium";
  // (c) milder momentum drop ≥30% on any buying account
  if (ciroPrev30 >= 1_000 && ciro30 < ciroPrev30 * 0.7) return "medium";

  // ACTIVE — recent activity AND has ciro
  if (dSale <= 30 && (ciro30 > 0 || ciroPrev30 > 0)) return "active";

  // Catch-all — usually means a tiny one-off purchase ages ago
  return "low";
}

/**
 * Human-readable explanation for why a customer ended up in their tier.
 * Mirrors the rules in computeRiskTier() — keep in sync if you change one.
 *
 * Used in the customer modal so a saha temsilcisi sees WHY the system
 * flagged this customer (without it, a 25-day-silent customer marked HIGH
 * looks like a bug to the rep).
 */
export function describeRiskReason(input: {
  daysSinceLastSale: number | null;
  daysSinceLastVisit: number | null;
  ciro30: number;
  ciroPrev30: number;
  riskTier: RiskTier;
}): string {
  const { daysSinceLastSale: dSale, daysSinceLastVisit: dVisit, ciro30, ciroPrev30, riskTier } = input;
  const fmt = (n: number) => Math.round(n).toLocaleString("tr-TR") + " ₺";
  const hasAnyHistory = ciro30 > 0 || ciroPrev30 > 0 || (dSale !== null && dSale < 365);

  if (riskTier === "high") {
    if (dSale === null) return ""; // shouldn't happen
    if (dSale >= 60 && hasAnyHistory)
      return `${dSale} gündür hiç sipariş yok, daha önce alıyordu`;
    if (dSale >= 30 && ciroPrev30 >= 10_000)
      return `${dSale} gündür sipariş yok; geçen 30 günde ${fmt(ciroPrev30)} alıyordu`;
    if (ciroPrev30 >= 5_000 && ciro30 < ciroPrev30 * 0.5) {
      const dropPct = Math.round(((ciroPrev30 - ciro30) / ciroPrev30) * 100);
      return `Ciro önceki 30 günde ${fmt(ciroPrev30)} iken son 30 günde ${fmt(ciro30)}'ye düştü (%${dropPct} kayıp)`;
    }
    return "Yüksek öncelikli risk";
  }

  if (riskTier === "medium") {
    if (dSale !== null && dSale >= 30 && hasAnyHistory)
      return `${dSale} gündür sipariş yok`;
    if ((dVisit ?? 999) >= 60 && hasAnyHistory)
      return `${dVisit} gündür hiç ziyaret edilmemiş`;
    if (ciroPrev30 >= 1_000 && ciro30 < ciroPrev30 * 0.7) {
      const dropPct = Math.round(((ciroPrev30 - ciro30) / ciroPrev30) * 100);
      return `Ciro %${dropPct} düşüş gösterdi (${fmt(ciroPrev30)} → ${fmt(ciro30)})`;
    }
    return "Erken uyarı";
  }

  if (riskTier === "active") {
    return `Son ${dSale ?? "?"} gün içinde satış oldu, ciro sağlıklı`;
  }

  // low
  if (dSale === null) return "Hiç sipariş kaydı yok";
  if (dSale >= 180) return `${dSale} gündür hiç sipariş yok`;
  return "Düşük öncelik";
}

// ---------------------------------------------------------------------------
// Composite Risk Score (yeni model — 0..100, 4 bileşenli, açıklanabilir)
// ---------------------------------------------------------------------------
//
// Eski `riskTier` tek bir eşik zincirine dayanıyordu; yeni model her müşteriye
// ayrıştırılabilir bir 0..100 skor + bileşen kırılımı + kullanıcıya gösterilen
// kısa sebep listesi üretir. Dış sinyal yok; tüm girdiler mevcut MSSQL'den
// (sync zamanı toplanan) read-only verilerden.
//
// Bileşen ağırlıkları:
//   momentum 0.40, behavioral 0.30, payment 0.20, engagement 0.10
//
// MVP-B (mevcut durum): `payment = null`. Üç bileşen üzerinden normalize
// edilir (toplam ağırlık 0.80'e bölünüp 100'e ölçeklenir). Kullanıcıya
// reason'da açıkça belirtilir.

export type RiskTierV2 =
  | "healthy"
  | "watch"
  | "risk"
  | "critical"
  | "unknown";

export type RiskComponentKey =
  | "momentum"
  | "behavioral"
  | "payment"
  | "engagement";

export type CustomerRiskScore = {
  /** 0..100 ya da yetersiz veri için null. */
  score: number | null;
  tier: RiskTierV2;
  /** Her bileşen 0..100 veya hesap edilemediyse null. */
  components: Record<RiskComponentKey, number | null>;
  /** UI'da kart altında bullet listesi olarak gösterilen kısa açıklamalar. */
  reasons: string[];
};

export type CustomerRiskScoreInput = {
  daysSinceLastSale: number | null;
  daysSinceLastVisit: number | null;
  ciro30: number;
  ciroPrev30: number;
  /** Son 90 günün toplam cirosu (3 ile bölünüp aylık baseline elde edilir). */
  ciroT90: number;
  /** -395..-365g penceresi (geçen yıl aynı 30g). */
  ciroYoy30d: number;
  fatura30: number;
  faturaPrev30: number;
  faturaT90: number;
  /** Son 30g distinct ürün grubu sayısı (sepet çeşitliliği). */
  urunGrup30: number;
  /** -60..-30g penceresi için aynı sinyal. */
  urunGrupPrev30: number;
  /** Son 90 gündeki ziyaret sayısı — beklenen cadence'i türetir. */
  ziyaret90: number;
};

/** Baseline cironun "anlamlı" sayılması için minimum eşik. Altındaki değerler
 *  "no signal" — yeni müşteri / dormant olduğu için skoru bozmamalı. */
const RISK_BASELINE_MIN = 1000; // TL

const RISK_WEIGHTS: Record<RiskComponentKey, number> = {
  momentum: 0.40,
  behavioral: 0.30,
  payment: 0.20,
  engagement: 0.10,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function linearMap(
  x: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function fmtTl(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ₺`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K ₺`;
  return `${Math.round(n)} ₺`;
}

function computeMomentum(input: CustomerRiskScoreInput): number | null {
  const { ciro30, ciroPrev30, ciroT90, ciroYoy30d, daysSinceLastSale } = input;
  const t90Monthly = ciroT90 / 3;

  const hasPrev = ciroPrev30 >= RISK_BASELINE_MIN;
  const hasT90 = t90Monthly >= RISK_BASELINE_MIN;
  const hasYoy = ciroYoy30d >= RISK_BASELINE_MIN;
  const hasCiro30 = ciro30 >= RISK_BASELINE_MIN;

  if (!hasPrev && !hasT90 && !hasYoy && !hasCiro30) return null;
  // Sağlam ciro var ama hiç baseline yok → yeni-ve-sağlıklı müşteri
  if (!hasPrev && !hasT90 && !hasYoy) return 0;

  // Mevcut baseline'lardan ağırlıklı ortalama "ciro düşüş oranı" (0..1)
  const parts: Array<[number, number]> = [];
  if (hasPrev) {
    const drop = Math.max(0, (ciroPrev30 - ciro30) / Math.max(ciroPrev30, 1));
    parts.push([drop, 0.45]);
  }
  if (hasT90) {
    const drop = Math.max(0, (t90Monthly - ciro30) / Math.max(t90Monthly, 1));
    parts.push([drop, 0.35]);
  }
  if (hasYoy) {
    const drop = Math.max(0, (ciroYoy30d - ciro30) / Math.max(ciroYoy30d, 1));
    parts.push([drop, 0.20]);
  }
  const wSum = parts.reduce((a, [, w]) => a + w, 0);
  const rawDrop = parts.reduce((a, [v, w]) => a + v * w, 0) / wSum;

  // Sessizlik factor'u — uzun sessizlik düşüşü amplify eder (max 1.5x)
  const silence = clamp((daysSinceLastSale ?? 0) / 60, 0, 1.5);
  return clamp(100 * rawDrop * (0.6 + 0.4 * silence), 0, 100);
}

function computeBehavioral(input: CustomerRiskScoreInput): number | null {
  const { daysSinceLastSale, fatura30, faturaPrev30, urunGrup30, urunGrupPrev30 } =
    input;

  // (A) Sessizlik bileşeni — her zaman üretilebilir
  let silenceC: number;
  if (daysSinceLastSale === null) {
    silenceC = 100; // hiç sipariş kaydı yok
  } else if (daysSinceLastSale < 14) {
    silenceC = 0;
  } else if (daysSinceLastSale < 30) {
    silenceC = linearMap(daysSinceLastSale, 14, 30, 0, 40);
  } else if (daysSinceLastSale < 60) {
    silenceC = linearMap(daysSinceLastSale, 30, 60, 40, 75);
  } else if (daysSinceLastSale < 120) {
    silenceC = linearMap(daysSinceLastSale, 60, 120, 75, 95);
  } else {
    silenceC = 100;
  }

  // (B) Sipariş frekansı düşüşü
  const freqDrop =
    faturaPrev30 > 0
      ? clamp(1 - fatura30 / faturaPrev30, 0, 1) * 100
      : fatura30 > 0
        ? 0
        : null;

  // (C) Sepet daralması (kategori çeşitliliği düşüşü)
  const basketShrink =
    urunGrupPrev30 > 0
      ? clamp(1 - urunGrup30 / urunGrupPrev30, 0, 1) * 100
      : null;

  const parts: Array<[number, number]> = [[silenceC, 0.50]];
  if (freqDrop !== null) parts.push([freqDrop, 0.30]);
  if (basketShrink !== null) parts.push([basketShrink, 0.20]);
  const wSum = parts.reduce((a, [, w]) => a + w, 0);
  return parts.reduce((a, [v, w]) => a + v * w, 0) / wSum;
}

function computeEngagement(input: CustomerRiskScoreInput): number | null {
  const { daysSinceLastVisit, ziyaret90, fatura30 } = input;
  if (daysSinceLastVisit === null) {
    // Hiç ziyaret yok — sağlam satış varsa anomali (70), yoksa sinyal yok
    return fatura30 > 0 ? 70 : null;
  }
  // Müşterinin beklenen ritmi — son 90g'de kaç ziyaret olduğuna göre adapte
  const expectedCadence = ziyaret90 >= 6 ? 15 : ziyaret90 >= 3 ? 30 : 60;
  const lag = daysSinceLastVisit / expectedCadence;
  if (lag <= 1.0) return 0;
  if (lag <= 1.5) return linearMap(lag, 1.0, 1.5, 0, 30);
  if (lag <= 2.5) return linearMap(lag, 1.5, 2.5, 30, 70);
  if (lag <= 4.0) return linearMap(lag, 2.5, 4.0, 70, 95);
  return 100;
}

function tierForScore(score: number): RiskTierV2 {
  if (score < 30) return "healthy";
  if (score < 55) return "watch";
  if (score < 75) return "risk";
  return "critical";
}

/**
 * Müşterinin 0..100 kompozit risk skoru + bileşen kırılımı + sebep listesi.
 * Saf fonksiyon — sync zamanı tek pas hesaplanır, sonuçlar SQLite'a yazılır.
 *
 * `payment` MVP'de daima null (Univera'da güvenilir vade/bakiye sinyali yok);
 * mevcut bileşenler kalan ağırlıkla normalize edilir.
 *
 * Tarihsel sinyal yoksa (hiç sipariş, hiç ziyaret, hiç ciro) `unknown` tier
 * döner — bu müşteriyi otomatik kritik göstermek yerine "yetersiz veri"
 * etiketi ile UI'da gri kalır.
 */
export function computeCustomerRiskScore(
  input: CustomerRiskScoreInput,
): CustomerRiskScore {
  // Global "hiç sinyal yok" kapısı. Dormant / hiç onboard edilmemiş müşteriler
  // (TEST kayıtları, eski tabelalar) bu kapıdan unknown'a düşer — eğer geçmiş
  // bir aktivite işareti varsa (eski satış, eski ziyaret, T90 cirosu) hesaba
  // gireriz.
  const hasAnyHistory =
    input.daysSinceLastSale !== null ||
    input.daysSinceLastVisit !== null ||
    input.ciroT90 > 0 ||
    input.ciroYoy30d > 0 ||
    input.faturaT90 > 0 ||
    input.ziyaret90 > 0;

  if (!hasAnyHistory) {
    return {
      score: null,
      tier: "unknown",
      components: {
        momentum: null,
        behavioral: null,
        payment: null,
        engagement: null,
      },
      reasons: [
        "Bu müşteri için yeterli geçmiş yok — son satış, son ziyaret veya 90g ciro kaydı bulunamadı.",
      ],
    };
  }

  const components: Record<RiskComponentKey, number | null> = {
    momentum: computeMomentum(input),
    behavioral: computeBehavioral(input),
    payment: null, // MVP-B
    engagement: computeEngagement(input),
  };

  const presentKeys = (Object.keys(components) as RiskComponentKey[]).filter(
    (k) => components[k] !== null,
  );
  const wSum = presentKeys.reduce((a, k) => a + RISK_WEIGHTS[k], 0);

  if (wSum === 0) {
    return {
      score: null,
      tier: "unknown",
      components,
      reasons: ["Yeterli veri yok — skor hesaplanamadı."],
    };
  }

  const weighted = presentKeys.reduce(
    (a, k) => a + RISK_WEIGHTS[k] * (components[k] as number),
    0,
  );
  const score = Math.round(weighted / wSum);
  return {
    score,
    tier: tierForScore(score),
    components,
    reasons: buildRiskReasons(input, components),
  };
}

function buildRiskReasons(
  input: CustomerRiskScoreInput,
  components: Record<RiskComponentKey, number | null>,
): string[] {
  // Bileşenleri katkı büyüklüğüne göre sırala (weight × value), payment hariç
  const contribs = (Object.keys(components) as RiskComponentKey[])
    .filter((k) => k !== "payment" && components[k] !== null)
    .map((k) => ({
      k,
      contrib: RISK_WEIGHTS[k] * (components[k] as number),
    }))
    .sort((a, b) => b.contrib - a.contrib);

  const reasons: string[] = [];
  for (const { k } of contribs.slice(0, 3)) {
    const r = reasonForComponent(k, input);
    if (r) reasons.push(r);
  }

  // MVP-B notu — her zaman ekle ki kullanıcı eksik bileşeni bilsin
  reasons.push(
    "Ödeme/vade verisi mevcut değil — skor satış, davranış ve etkileşim ile hesaplandı.",
  );
  return reasons;
}

function reasonForComponent(
  k: RiskComponentKey,
  input: CustomerRiskScoreInput,
): string | null {
  switch (k) {
    case "momentum": {
      const { ciro30, ciroPrev30, ciroT90, ciroYoy30d } = input;
      const t90Monthly = ciroT90 / 3;
      const candidates: Array<{ label: string; drop: number; base: number }> = [];
      if (ciroPrev30 >= RISK_BASELINE_MIN) {
        candidates.push({
          label: "önceki 30g",
          drop: (ciroPrev30 - ciro30) / Math.max(ciroPrev30, 1),
          base: ciroPrev30,
        });
      }
      if (t90Monthly >= RISK_BASELINE_MIN) {
        candidates.push({
          label: "90g aylık baseline",
          drop: (t90Monthly - ciro30) / Math.max(t90Monthly, 1),
          base: t90Monthly,
        });
      }
      if (ciroYoy30d >= RISK_BASELINE_MIN) {
        candidates.push({
          label: "geçen yıl aynı dönem",
          drop: (ciroYoy30d - ciro30) / Math.max(ciroYoy30d, 1),
          base: ciroYoy30d,
        });
      }
      const meaningful = candidates
        .filter((c) => c.drop > 0.1)
        .sort((a, b) => b.drop - a.drop);
      const top = meaningful[0];
      if (!top) return null;
      return `Son 30g ciro ${top.label}'a göre %${Math.round(top.drop * 100)} düştü (${fmtTl(top.base)} → ${fmtTl(ciro30)})`;
    }
    case "behavioral": {
      const {
        daysSinceLastSale,
        fatura30,
        faturaPrev30,
        urunGrup30,
        urunGrupPrev30,
      } = input;
      if (daysSinceLastSale === null) return "Hiç sipariş kaydı yok.";
      if (daysSinceLastSale >= 30) {
        return `${daysSinceLastSale} gündür sipariş yok.`;
      }
      if (faturaPrev30 > 0 && fatura30 / faturaPrev30 < 0.5) {
        return `Sipariş frekansı düştü: önceki 30g ${faturaPrev30} fatura → son 30g ${fatura30}.`;
      }
      if (urunGrupPrev30 > 0 && urunGrup30 / urunGrupPrev30 < 0.5) {
        return `Sepet daraldı: önceki 30g ${urunGrupPrev30} kategori → son 30g ${urunGrup30}.`;
      }
      return null;
    }
    case "engagement": {
      const { daysSinceLastVisit, ziyaret90 } = input;
      if (daysSinceLastVisit === null) return "Hiç ziyaret kaydı yok.";
      const expectedCadence = ziyaret90 >= 6 ? 15 : ziyaret90 >= 3 ? 30 : 60;
      if (daysSinceLastVisit / expectedCadence > 1.3) {
        return `Beklenen ritim ${expectedCadence}g, ${daysSinceLastVisit} gündür ziyaret yok.`;
      }
      return null;
    }
    case "payment":
      return null; // MVP-B'de aktif değil
  }
}

export type MapCustomerFilters = {
  sehir?: string;
  distKod?: number;
  /** TBLDISTGRUP-bazlı bölge filtresi (legacy). */
  bolge?: string;
  /** Klasik 7 bölge filtresi (drill-down için). "Marmara", "Ege"... — server
   *  bunu kapsadığı il listesine açar ve sehir IN (...) ile filtreler. */
  region?: string;
  /** "with" → only customers with recent sales, "without" → only silent
   *  customers, undefined → no filter. */
  salesFilter?: "with" | "without";
  /** @deprecated Eski 4-tier filter (`risk_tier` kolonu). Yeni UI `tier`
   *  kullanır; her ikisi de aynı anda geçirilirse `tier` öncelikli. */
  riskTier?: RiskTier;
  /** Composite Risk Score tier filter (`risk_tier_v2` kolonu). */
  tier?: RiskTierV2;
  /** Show only customers not visited for ≥ N days. */
  minDaysSinceVisit?: number;
  limit?: number;
  /** Dist-bazlı veri izolasyonu — sunucu-otoriter. null/undefined → merkez
   *  (filtre yok), dizi → yalnızca bu dist_kod'lara ait müşteriler. */
  allowedDistKods?: number[] | null;
};

export type MapFacets = {
  cities: string[];
  distributors: { lngKod: number; ad: string }[];
};

export type MapSyncStatus = {
  lastSyncAt: string | null;
  durationMs: number;
  customerCount: number;
  cityCount: number;
  distCount: number;
};

/**
 * Reads the customer set from the LOCAL SQLite mirror — never touches
 * MSSQL on the request path. The mirror is populated by syncMapData()
 * (see below), which is the only function that reaches out to MSSQL.
 *
 * Filter combinations are applied in JavaScript here too — at pilot
 * scale the cached set is at most a few thousand rows so it's fine.
 */
export async function listMapCustomers(
  repoRoot: string,
  filters: MapCustomerFilters = {},
): Promise<MapCustomer[]> {
  const db = getLocalDb(repoRoot);
  const limit = Math.min(Math.max(filters.limit ?? 5000, 1), 50_000);

  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.sehir) {
    // Case + diacritic-insensitive eşleştirme. DB tarafında Pernod
    // ("İZMİR" — Türkçe upper), FMCG demo ("İzmir" — canonical mixed),
    // ve olası eski state ("IZMIR" — ASCII upper) hepsi mevcut olabiliyor.
    // URL'den de farklı form'lar gelebiliyor (geojson "İzmir" vs eski cache
    // "İZMİR"). İki tarafı da SAME normalize → eşleşme garantilenir.
    where.push(`${SEHIR_NORM_SQL("sehir")} = ${SEHIR_NORM_SQL("@sehir")}`);
    params.sehir = filters.sehir;
  }
  if (filters.bolge) {
    where.push("bolge = @bolge");
    params.bolge = filters.bolge;
  }
  if (filters.region) {
    // Klasik bölge → kapsanan il listesi → sehir IN (...). DB'deki sehir
    // değerleri normalize değilse (örn. "İstanbul" vs "ISTANBUL") UPPER ile
    // normalize ettiriyoruz; biraz daha pahalı ama doğru.
    const master = await loadRegionMaster();
    const info = master.byRegion.get(filters.region);
    if (info && info.provinces.length > 0) {
      const placeholders: string[] = [];
      info.provinces.forEach((p, i) => {
        const key = `region_p${i}`;
        placeholders.push(`@${key}`);
        params[key] = p;
      });
      // Normalize DB sehir → match upper + diacritic strip karakter setiyle
      // (SQLite COLLATE NOCASE Türkçe diakritik için tam doğru değildir).
      where.push(
        `UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(sehir,
          'İ','I'),'ı','I'),'Ş','S'),'ş','S'),'Ğ','G'),'ğ','G'),'Ü','U'),'ü','U'))
         IN (${placeholders.join(",")})`,
      );
    }
  }
  if (typeof filters.distKod === "number" && Number.isFinite(filters.distKod)) {
    where.push("dist_kod = @distKod");
    params.distKod = Math.floor(filters.distKod);
  }
  if (filters.salesFilter === "with") {
    where.push("has_sales = 1");
  } else if (filters.salesFilter === "without") {
    where.push("has_sales = 0");
  }

  // Yeni tier filter (composite Risk Score) varsa onu kullan; yoksa eski
  // riskTier üzerinden filtrele. UI cutover sonrası riskTier kaldırılır.
  if (filters.tier) {
    where.push("risk_tier_v2 = @tier");
    params.tier = filters.tier;
  } else if (filters.riskTier) {
    where.push("risk_tier = @riskTier");
    params.riskTier = filters.riskTier;
  }
  if (typeof filters.minDaysSinceVisit === "number") {
    where.push("(days_since_last_visit IS NULL OR days_since_last_visit >= @minDaysSinceVisit)");
    params.minDaysSinceVisit = Math.floor(filters.minDaysSinceVisit);
  }
  // Dist-bazlı veri izolasyonu — sunucu-otoriter. Integer dizisi olduğu için
  // `.join(",")` güvenli (Number.isInteger guard'lı, parametreli değil).
  const distIsoClause = sqliteDistFilter(filters.allowedDistKods);
  if (distIsoClause) where.push(distIsoClause.replace(/^ AND /, ""));

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT id, dist_kod AS distKod, unvan, kisa_ad AS kisaAd, adres, sehir,
           ilce, distributor, bolge, lat, lng, has_sales AS hasSales,
           days_since_last_sale  AS daysSinceLastSale,
           days_since_last_visit AS daysSinceLastVisit,
           ciro_30d              AS ciro30,
           ciro_prev_30d         AS ciroPrev30,
           risk_tier             AS riskTier,
           risk_score            AS riskScore,
           risk_tier_v2          AS riskTierV2,
           risk_components       AS riskComponents,
           risk_reasons          AS riskReasons
    FROM map_customers
    ${whereSql}
    ORDER BY
      CASE risk_tier WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,
      has_sales DESC,
      id
    LIMIT @limit
  `;
  const rows = db.prepare(sql).all({ ...params, limit }) as Array<{
    id: number;
    distKod: number | null;
    unvan: string;
    kisaAd: string | null;
    adres: string | null;
    sehir: string | null;
    ilce: string | null;
    distributor: string | null;
    bolge: string | null;
    lat: number;
    lng: number;
    hasSales: number;
    daysSinceLastSale: number | null;
    daysSinceLastVisit: number | null;
    ciro30: number | null;
    ciroPrev30: number | null;
    riskTier: string | null;
    riskScore: number | null;
    riskTierV2: string | null;
    riskComponents: string | null;
    riskReasons: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    distKod: r.distKod ?? null,
    unvan: r.unvan,
    kisaAd: r.kisaAd ?? null,
    adres: r.adres,
    sehir: r.sehir,
    ilce: r.ilce,
    distributor: r.distributor,
    bolge: r.bolge,
    lat: r.lat,
    lng: r.lng,
    hasSales: r.hasSales === 1,
    daysSinceLastSale: r.daysSinceLastSale ?? null,
    daysSinceLastVisit: r.daysSinceLastVisit ?? null,
    ciro30: r.ciro30 ?? 0,
    ciroPrev30: r.ciroPrev30 ?? 0,
    riskTier: (r.riskTier as RiskTier) ?? "low",
    riskScore: rehydrateRiskScore(r),
  }));
}

/**
 * SQLite rows'tan `CustomerRiskScore` döndürür. Yeni sync hâlâ çalışmamışsa
 * (eski rows, risk_score = NULL) `unknown` tier ile placeholder döner — UI'da
 * "yeniden sync gerekli" sinyali olarak okunabilir.
 */
function rehydrateRiskScore(r: {
  riskScore: number | null;
  riskTierV2: string | null;
  riskComponents: string | null;
  riskReasons: string | null;
}): CustomerRiskScore {
  const fallback: CustomerRiskScore = {
    score: null,
    tier: "unknown",
    components: {
      momentum: null,
      behavioral: null,
      payment: null,
      engagement: null,
    },
    reasons: ["Risk skoru bu müşteri için henüz hesaplanmadı (yeniden sync)."],
  };

  if (r.riskScore === null && !r.riskTierV2) return fallback;

  let components = fallback.components;
  if (r.riskComponents) {
    try {
      const parsed = JSON.parse(r.riskComponents) as Partial<
        Record<RiskComponentKey, number | null>
      >;
      components = {
        momentum: parsed.momentum ?? null,
        behavioral: parsed.behavioral ?? null,
        payment: parsed.payment ?? null,
        engagement: parsed.engagement ?? null,
      };
    } catch {
      // bozuk JSON → fallback components
    }
  }
  let reasons: string[] = fallback.reasons;
  if (r.riskReasons) {
    try {
      const parsed = JSON.parse(r.riskReasons);
      if (Array.isArray(parsed)) {
        reasons = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // bozuk JSON → fallback reasons
    }
  }

  const tier = isRiskTierV2(r.riskTierV2) ? r.riskTierV2 : "unknown";
  return { score: r.riskScore, tier, components, reasons };
}

function isRiskTierV2(s: string | null): s is RiskTierV2 {
  return (
    s === "healthy" ||
    s === "watch" ||
    s === "risk" ||
    s === "critical" ||
    s === "unknown"
  );
}

/**
 * Klasik 7 bölge bazlı toplu görünüm. Müşterinin `sehir` alanı (TXTSEHIR)
 * `data/geo/tr-province-region.json` ile Marmara/Ege/Akdeniz/İç Anadolu/
 * Karadeniz/Doğu Anadolu/Güneydoğu Anadolu/Kıbrıs eşlemesine sokulur, sonra
 * bu klasik bölgeye göre agregat alınır.
 *
 * Avantaj (eski TBLDISTGRUP-bazlı `bolge` yerine): standart TR coğrafyası,
 * il sınırı GeoJSON'u ile birebir uyumlu, drill-down il bazına yapılabilir.
 */
export type MapRegion = {
  bolge: string;
  musteriSayisi: number;
  /** @deprecated Eski 4-tier dağılımı. UI cutover sonrası kaldırılır. */
  high: number;
  medium: number;
  active: number;
  low: number;
  /** Composite Risk Score tier dağılımı — yeni model. */
  critical: number;
  risk: number;
  watch: number;
  healthy: number;
  /** Yeterli veri olmayan müşteriler. */
  unknown: number;
  /** Centroid — müşteri konumlarının ortalaması (etiket konumu için). */
  lat: number;
  lng: number;
  /** Toplam 30g ciro. */
  ciro30: number;
  /** Klasik bölge rengi (tr-province-region.json'dan). */
  color: string;
  /** Bölgenin kapsadığı iller (normalize edilmiş, drill-down için). */
  provinces: string[];
};

export type MapRegionFilters = {
  /** Tek bir sehir filtresi (drill-down sonrası kullanılır). */
  sehir?: string;
  distKod?: number;
  salesFilter?: "with" | "without";
  /** @deprecated Eski 4-tier filter. Yeni UI `tier` kullanır. */
  riskTier?: RiskTier;
  /** Composite Risk Score tier filter. */
  tier?: RiskTierV2;
  minDaysSinceVisit?: number;
  /** Dist-bazlı veri izolasyonu — sunucu-otoriter. null/undefined → merkez. */
  allowedDistKods?: number[] | null;
};

export async function listMapRegions(
  repoRoot: string,
  filters: MapRegionFilters = {},
): Promise<MapRegion[]> {
  const db = getLocalDb(repoRoot);
  const master = await loadRegionMaster();

  const where: string[] = ["sehir IS NOT NULL AND sehir <> ''"];
  const params: Record<string, unknown> = {};
  if (filters.sehir) {
    // Case + diacritic-insensitive eşleştirme (bkz. üst not).
    where.push(`${SEHIR_NORM_SQL("sehir")} = ${SEHIR_NORM_SQL("@sehir")}`);
    params.sehir = filters.sehir;
  }
  if (typeof filters.distKod === "number" && Number.isFinite(filters.distKod)) {
    where.push("dist_kod = @distKod");
    params.distKod = Math.floor(filters.distKod);
  }
  if (filters.salesFilter === "with") where.push("has_sales = 1");
  else if (filters.salesFilter === "without") where.push("has_sales = 0");
  // Yeni tier filtresi öncelikli; yoksa eski riskTier.
  if (filters.tier) {
    where.push("risk_tier_v2 = @tier");
    params.tier = filters.tier;
  } else if (filters.riskTier) {
    where.push("risk_tier = @riskTier");
    params.riskTier = filters.riskTier;
  }
  if (typeof filters.minDaysSinceVisit === "number") {
    where.push("(days_since_last_visit IS NULL OR days_since_last_visit >= @minDaysSinceVisit)");
    params.minDaysSinceVisit = Math.floor(filters.minDaysSinceVisit);
  }
  // Dist-bazlı veri izolasyonu — sunucu-otoriter.
  const distIsoClauseRegions = sqliteDistFilter(filters.allowedDistKods);
  if (distIsoClauseRegions) where.push(distIsoClauseRegions.replace(/^ AND /, ""));

  // Önce şehir bazlı agg, sonra JS tarafında klasik bölgeye topla.
  // (SQLite tarafında province → region mapping yapacak fonksiyon yok;
  //  JS post-process tek pas.)
  const sql = `
    SELECT
      sehir,
      COUNT(*)                                                 AS musteriSayisi,
      SUM(CASE WHEN risk_tier = 'high'   THEN 1 ELSE 0 END)     AS high,
      SUM(CASE WHEN risk_tier = 'medium' THEN 1 ELSE 0 END)     AS medium,
      SUM(CASE WHEN risk_tier = 'active' THEN 1 ELSE 0 END)     AS active,
      SUM(CASE WHEN risk_tier = 'low'    THEN 1 ELSE 0 END)     AS low,
      SUM(CASE WHEN risk_tier_v2 = 'critical' THEN 1 ELSE 0 END) AS critical,
      SUM(CASE WHEN risk_tier_v2 = 'risk'     THEN 1 ELSE 0 END) AS riskCount,
      SUM(CASE WHEN risk_tier_v2 = 'watch'    THEN 1 ELSE 0 END) AS watch,
      SUM(CASE WHEN risk_tier_v2 = 'healthy'  THEN 1 ELSE 0 END) AS healthy,
      SUM(CASE WHEN risk_tier_v2 = 'unknown' OR risk_tier_v2 IS NULL THEN 1 ELSE 0 END) AS unknownCount,
      AVG(lat)                                                  AS lat,
      AVG(lng)                                                  AS lng,
      SUM(COALESCE(ciro_30d, 0))                                AS ciro30
    FROM map_customers
    WHERE ${where.join(" AND ")}
    GROUP BY sehir
  `;

  const cityRows = db.prepare(sql).all(params) as Array<{
    sehir: string;
    musteriSayisi: number;
    high: number;
    medium: number;
    active: number;
    low: number;
    critical: number;
    riskCount: number;
    watch: number;
    healthy: number;
    unknownCount: number;
    lat: number;
    lng: number;
    ciro30: number | null;
  }>;

  // Şehir → klasik bölge gruplama
  type Agg = {
    musteriSayisi: number;
    // Legacy tier sayımları
    high: number;
    medium: number;
    active: number;
    low: number;
    // Yeni tier sayımları
    critical: number;
    risk: number;
    watch: number;
    healthy: number;
    unknown: number;
    latSum: number;
    lngSum: number;
    latWeight: number;
    ciro30: number;
    provinces: Set<string>;
  };
  const byRegion = new Map<string, Agg>();

  for (const r of cityRows) {
    const norm = normalizeProvince(r.sehir);
    const info = master.byProvince.get(norm);
    if (!info) continue; // eşleşmeyen şehir (örn. yanlış değer) — atla
    const agg = byRegion.get(info.region) ?? {
      musteriSayisi: 0,
      high: 0, medium: 0, active: 0, low: 0,
      critical: 0, risk: 0, watch: 0, healthy: 0, unknown: 0,
      latSum: 0, lngSum: 0, latWeight: 0,
      ciro30: 0,
      provinces: new Set<string>(),
    };
    const w = Number(r.musteriSayisi);
    agg.musteriSayisi += w;
    agg.high += Number(r.high);
    agg.medium += Number(r.medium);
    agg.active += Number(r.active);
    agg.low += Number(r.low);
    agg.critical += Number(r.critical);
    agg.risk += Number(r.riskCount);
    agg.watch += Number(r.watch);
    agg.healthy += Number(r.healthy);
    agg.unknown += Number(r.unknownCount);
    // Weighted centroid — il merkezleri büyük illere göre ağırlıklı
    agg.latSum += Number(r.lat) * w;
    agg.lngSum += Number(r.lng) * w;
    agg.latWeight += w;
    agg.ciro30 += Number(r.ciro30 ?? 0);
    agg.provinces.add(norm);
    byRegion.set(info.region, agg);
  }

  const out: MapRegion[] = [];
  for (const [regionName, agg] of byRegion.entries()) {
    const info = master.byRegion.get(regionName);
    // Etiket konumu: master'daki sabit centroid (haritada bölgenin coğrafi
    // ortasında oluyor). Customer weighted ortalama outlier'lara duyarlıydı
    // (örn. yanlış koordinatlı tek müşteri tüm bölgeyi Rusya'ya kaydırıyordu).
    const centroid = info?.centroid ?? [
      agg.latWeight > 0 ? agg.lngSum / agg.latWeight : 35,
      agg.latWeight > 0 ? agg.latSum / agg.latWeight : 39,
    ];
    out.push({
      bolge: regionName,
      musteriSayisi: agg.musteriSayisi,
      high: agg.high,
      medium: agg.medium,
      active: agg.active,
      low: agg.low,
      critical: agg.critical,
      risk: agg.risk,
      watch: agg.watch,
      healthy: agg.healthy,
      unknown: agg.unknown,
      lng: centroid[0],
      lat: centroid[1],
      ciro30: agg.ciro30,
      color: info?.color ?? "#78716c",
      provinces: Array.from(agg.provinces).sort(),
    });
  }
  out.sort((a, b) => b.musteriSayisi - a.musteriSayisi);
  return out;
}

export function getMapFacets(repoRoot: string): MapFacets {
  const db = getLocalDb(repoRoot);
  const cities = (
    db.prepare("SELECT sehir FROM map_cities ORDER BY sehir").all() as Array<{ sehir: string }>
  ).map((r) => r.sehir);
  const distributors = (
    db
      .prepare("SELECT lng_kod AS lngKod, ad FROM map_distributors ORDER BY ad")
      .all() as Array<{ lngKod: number; ad: string }>
  ).map((r) => ({ lngKod: r.lngKod, ad: r.ad }));
  return { cities, distributors };
}

/**
 * Bir müşterinin `dist_kod`'unun scope içinde olup olmadığını SQLite
 * mirror'dan kontrol eder. Dist kullanıcı başka dist'in müşteri detayını
 * (satış/foresight) görememelidir — server.ts bu sonuca göre 403/404 döner.
 *
 * `allowedDistKods == null` → merkez, her zaman true.
 * Müşteri mirror'da bulunamazsa (senkron gecikmesi/hatalı id) da `true`
 * döner — var olmayan kayıt için 404 zaten ayrı bir kontrolle ele alınmalı,
 * bu fonksiyon SADECE "başka dist'in müşterisi" durumunu yakalar.
 */
export function customerInScope(
  repoRoot: string,
  musteriKod: number,
  allowedDistKods: number[] | null | undefined,
): boolean {
  if (allowedDistKods == null) return true;
  const db = getLocalDb(repoRoot);
  const row = db
    .prepare("SELECT dist_kod AS distKod FROM map_customers WHERE id = ?")
    .get(Math.floor(musteriKod)) as { distKod: number | null } | undefined;
  if (!row) return true;
  if (row.distKod == null) return true;
  return allowedDistKods.includes(row.distKod);
}

export function getSyncStatus(repoRoot: string): MapSyncStatus {
  const db = getLocalDb(repoRoot);
  const row = db
    .prepare(
      `SELECT last_sync_at AS lastSyncAt, duration_ms AS durationMs,
              customer_count AS customerCount, city_count AS cityCount,
              dist_count AS distCount
       FROM sync_state WHERE domain = 'map'`,
    )
    .get() as MapSyncStatus | undefined;
  return (
    row ?? {
      lastSyncAt: null,
      durationMs: 0,
      customerCount: 0,
      cityCount: 0,
      distCount: 0,
    }
  );
}

/**
 * Pulls the map customer set + facet lists from MSSQL in a single trip
 * each, then replaces the SQLite mirror inside one transaction. This is
 * the ONLY function that talks to MSSQL on the map data path; the
 * dashboard reads from SQLite afterwards.
 */
export async function syncMapData(repoRoot: string): Promise<MapSyncStatus> {
  const startedAt = Date.now();

  // Pre-aggregated risk dimensions per customer — single trip during sync so
  // map page renders use only SQLite. Composite Risk Score (yeni model) JS
  // tarafında `computeCustomerRiskScore` ile son adımda hesaplanır.
  //
  // CTE'ler her biri ~2 sn (probe ölçümleri; bkz. scripts/probe-risk-fields
  // çıktıları). Toplam ek maliyet ~10 sn — kabul edilebilir.
  const customerSql = `
    WITH son_satis AS (
      SELECT f.LNGMUSTERIKOD, MAX(f.TRHISLEMTARIHI) AS son
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      GROUP BY f.LNGMUSTERIKOD
    ),
    ciro_30 AS (
      SELECT f.LNGMUSTERIKOD,
             SUM(f.DBLNETTUTAR) AS ciro,
             COUNT(*)           AS fatura
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
      GROUP BY f.LNGMUSTERIKOD
    ),
    ciro_prev_30 AS (
      SELECT f.LNGMUSTERIKOD,
             SUM(f.DBLNETTUTAR) AS ciro,
             COUNT(*)           AS fatura
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -60, GETDATE())
        AND f.TRHISLEMTARIHI <  DATEADD(day, -30, GETDATE())
      GROUP BY f.LNGMUSTERIKOD
    ),
    -- Risk skoru momentum bileşeni için: 90 günlük baseline + YoY pencere
    ciro_t90 AS (
      SELECT f.LNGMUSTERIKOD,
             SUM(f.DBLNETTUTAR) AS ciro,
             COUNT(*)           AS fatura
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -90, GETDATE())
      GROUP BY f.LNGMUSTERIKOD
    ),
    ciro_yoy_30d AS (
      SELECT f.LNGMUSTERIKOD, SUM(f.DBLNETTUTAR) AS ciro
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -395, GETDATE())
        AND f.TRHISLEMTARIHI <  DATEADD(day, -365, GETDATE())
      GROUP BY f.LNGMUSTERIKOD
    ),
    -- Sepet çeşitliliği — davranışsal bileşen için.
    -- 4-tablo JOIN, probe ölçümünde ~2 sn / pencere.
    urun_grup_30 AS (
      SELECT f.LNGMUSTERIKOD,
             COUNT(DISTINCT COALESCE(g.TXTAD, u.TXTAD)) AS grupSayi
      FROM dbo.TBLMSDFATURA AS f
      INNER JOIN dbo.TBLMSDBELGEDETAY AS bd
        ON bd.LNGYIL = f.LNGYIL
       AND bd.LNGFATURAKOD = f.LNGBELGEKOD
       AND bd.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN AS u ON u.LNGKOD = bd.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP AS g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
      GROUP BY f.LNGMUSTERIKOD
    ),
    urun_grup_prev_30 AS (
      SELECT f.LNGMUSTERIKOD,
             COUNT(DISTINCT COALESCE(g.TXTAD, u.TXTAD)) AS grupSayi
      FROM dbo.TBLMSDFATURA AS f
      INNER JOIN dbo.TBLMSDBELGEDETAY AS bd
        ON bd.LNGYIL = f.LNGYIL
       AND bd.LNGFATURAKOD = f.LNGBELGEKOD
       AND bd.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN AS u ON u.LNGKOD = bd.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP AS g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -60, GETDATE())
        AND f.TRHISLEMTARIHI <  DATEADD(day, -30, GETDATE())
      GROUP BY f.LNGMUSTERIKOD
    ),
    son_ziyaret AS (
      SELECT z.LNGMUSTERIKOD,
             MAX(z.TRHGIRIS) AS son,
             SUM(CASE WHEN z.TRHGIRIS >= DATEADD(day, -90, GETDATE())
                      THEN 1 ELSE 0 END) AS ziyaret90
      FROM dbo.TBLPMPZIYARETBASLIK AS z
      WHERE z.TRHGIRIS IS NOT NULL
      GROUP BY z.LNGMUSTERIKOD
    )
    SELECT
      m.LNGKOD       AS id,
      m.LNGDISTKOD   AS distKod,
      m.TXTUNVAN     AS unvan,
      m.TXTKISAAD    AS kisaAd,
      m.TXTADRES1    AS adres,
      m.TXTSEHIR     AS sehir,
      m.TXTILCE      AS ilce,
      d.TXTAD        AS distributor,
      -- Bölge: TBLDIST.TXTEKGRUP → TBLDISTEKGRUP.TXTAD (standart 5-bölge:
      -- MARMARA/EGE/ANADOLU/AKDENİZ/GÜNEYDOĞU). LNGDISTKOD şartı yok
      -- (her ikisi de NULL olduğu için JOIN'i boşaltır).
      g.TXTAD        AS bolge,
      CAST(m.DBLKOORDINATX AS FLOAT) AS lat,
      CAST(m.DBLKOORDINATY AS FLOAT) AS lng,
      CASE WHEN c30.LNGMUSTERIKOD IS NULL THEN 0 ELSE 1 END AS hasSales,
      CASE WHEN s.son IS NULL THEN NULL ELSE DATEDIFF(day, s.son, GETDATE()) END AS daysSinceLastSale,
      CASE WHEN z.son IS NULL THEN NULL ELSE DATEDIFF(day, z.son, GETDATE()) END AS daysSinceLastVisit,
      ISNULL(c30.ciro,   0)   AS ciro30,
      ISNULL(c30.fatura, 0)   AS fatura30,
      ISNULL(cp30.ciro,  0)   AS ciroPrev30,
      ISNULL(cp30.fatura,0)   AS faturaPrev30,
      ISNULL(ct90.ciro,  0)   AS ciroT90,
      ISNULL(ct90.fatura,0)   AS faturaT90,
      ISNULL(cyoy.ciro,  0)   AS ciroYoy30,
      ISNULL(ug30.grupSayi,  0) AS urunGrup30,
      ISNULL(ugp30.grupSayi, 0) AS urunGrupPrev30,
      ISNULL(z.ziyaret90, 0)    AS ziyaret90
    FROM dbo.TBLMUSTERI AS m
    LEFT JOIN dbo.TBLDIST    AS d   ON d.LNGKOD = m.LNGDISTKOD
    LEFT JOIN dbo.TBLDISTEKGRUP AS g  ON g.TXTKOD = d.TXTEKGRUP
    LEFT JOIN son_satis        AS s    ON s.LNGMUSTERIKOD    = m.LNGKOD
    LEFT JOIN ciro_30          AS c30  ON c30.LNGMUSTERIKOD  = m.LNGKOD
    LEFT JOIN ciro_prev_30     AS cp30 ON cp30.LNGMUSTERIKOD = m.LNGKOD
    LEFT JOIN ciro_t90         AS ct90 ON ct90.LNGMUSTERIKOD = m.LNGKOD
    LEFT JOIN ciro_yoy_30d     AS cyoy ON cyoy.LNGMUSTERIKOD = m.LNGKOD
    LEFT JOIN urun_grup_30     AS ug30  ON ug30.LNGMUSTERIKOD  = m.LNGKOD
    LEFT JOIN urun_grup_prev_30 AS ugp30 ON ugp30.LNGMUSTERIKOD = m.LNGKOD
    LEFT JOIN son_ziyaret      AS z    ON z.LNGMUSTERIKOD    = m.LNGKOD
    -- md19: sadece AKTİF müşteri + AKTİF distribütör altındakiler.
    -- Pasif müşteri (m.BYTDURUM) veya pasif/eksik dist (d.BYTDURUM) haritaya
    -- girmesin — aksi halde nokta sayısı gerçek aktiften fazla çıkıyordu.
    WHERE m.DBLKOORDINATX > 0 AND m.DBLKOORDINATY > 0
      AND m.BYTDURUM = 0 AND d.BYTDURUM = 0
    ORDER BY hasSales DESC, m.LNGKOD
  `;
  const cityFacetSql = `
    SELECT DISTINCT TOP 500 LTRIM(RTRIM(m.TXTSEHIR)) AS sehir
    FROM dbo.TBLMUSTERI AS m
    WHERE m.TXTSEHIR IS NOT NULL
      AND LTRIM(RTRIM(m.TXTSEHIR)) <> ''
    ORDER BY sehir
  `;
  const distFacetSql = `
    SELECT TOP 500 d.LNGKOD AS lngKod, d.TXTAD AS ad
    FROM dbo.TBLDIST AS d
    WHERE d.BYTDURUM = 0 AND d.TXTAD IS NOT NULL
      AND LTRIM(RTRIM(d.TXTAD)) <> ''
    ORDER BY ad
  `;

  const [customersRes, citiesRes, distsRes] = await Promise.all([
    runReadOnly(customerSql, { limit: 200_000, timeoutMs: 120_000 }),
    runReadOnly(cityFacetSql, { limit: 1000, timeoutMs: 30_000 }),
    runReadOnly(distFacetSql, { limit: 1000, timeoutMs: 30_000 }),
  ]);

  const db = getLocalDb(repoRoot);
  const insCustomer = db.prepare(`
    INSERT INTO map_customers
      (id, dist_kod, unvan, kisa_ad, adres, sehir, ilce, distributor, bolge,
       lat, lng, has_sales,
       days_since_last_sale, days_since_last_visit,
       ciro_30d, ciro_prev_30d, risk_tier,
       ciro_t90, ciro_yoy_30d,
       fatura_30d, fatura_prev_30d, fatura_t90,
       urun_grup_30d, urun_grup_prev_30d,
       ziyaret_90d,
       risk_score, risk_tier_v2, risk_components, risk_reasons)
    VALUES
      (@id, @distKod, @unvan, @kisaAd, @adres, @sehir, @ilce, @distributor, @bolge,
       @lat, @lng, @hasSales,
       @daysSinceLastSale, @daysSinceLastVisit,
       @ciro30, @ciroPrev30, @riskTier,
       @ciroT90, @ciroYoy30d,
       @fatura30, @faturaPrev30, @faturaT90,
       @urunGrup30, @urunGrupPrev30,
       @ziyaret90,
       @riskScore, @riskTierV2, @riskComponents, @riskReasons)
  `);
  const insCity = db.prepare("INSERT OR IGNORE INTO map_cities (sehir) VALUES (?)");
  const insDist = db.prepare(
    "INSERT OR IGNORE INTO map_distributors (lng_kod, ad) VALUES (?, ?)",
  );

  const replaceAll = db.transaction(() => {
    db.exec("DELETE FROM map_customers; DELETE FROM map_cities; DELETE FROM map_distributors;");
    for (const r of customersRes.rows) {
      const daysSinceLastSale = r.daysSinceLastSale == null ? null : Number(r.daysSinceLastSale);
      const daysSinceLastVisit = r.daysSinceLastVisit == null ? null : Number(r.daysSinceLastVisit);
      const ciro30 = Number(r.ciro30 ?? 0);
      const ciroPrev30 = Number(r.ciroPrev30 ?? 0);
      const ciroT90 = Number(r.ciroT90 ?? 0);
      const ciroYoy30d = Number(r.ciroYoy30 ?? 0);
      const fatura30 = Number(r.fatura30 ?? 0);
      const faturaPrev30 = Number(r.faturaPrev30 ?? 0);
      const faturaT90 = Number(r.faturaT90 ?? 0);
      const urunGrup30 = Number(r.urunGrup30 ?? 0);
      const urunGrupPrev30 = Number(r.urunGrupPrev30 ?? 0);
      const ziyaret90 = Number(r.ziyaret90 ?? 0);

      // Yeni composite skor — saf JS fonksiyonu, MSSQL'e geri dönmez
      const score = computeCustomerRiskScore({
        daysSinceLastSale,
        daysSinceLastVisit,
        ciro30,
        ciroPrev30,
        ciroT90,
        ciroYoy30d,
        fatura30,
        faturaPrev30,
        faturaT90,
        urunGrup30,
        urunGrupPrev30,
        ziyaret90,
      });

      insCustomer.run({
        id: Number(r.id),
        distKod: r.distKod == null ? null : Number(r.distKod),
        unvan: String(r.unvan ?? ""),
        kisaAd: (r.kisaAd as string | null) ?? null,
        adres: (r.adres as string | null) ?? null,
        sehir: (r.sehir as string | null) ?? null,
        ilce: (r.ilce as string | null) ?? null,
        distributor: (r.distributor as string | null) ?? null,
        bolge: (r.bolge as string | null) ?? null,
        lat: Number(r.lat),
        lng: Number(r.lng),
        hasSales: Number(r.hasSales) === 1 ? 1 : 0,
        daysSinceLastSale,
        daysSinceLastVisit,
        ciro30,
        ciroPrev30,
        riskTier: computeRiskTier({
          daysSinceLastSale,
          daysSinceLastVisit,
          ciro30,
          ciroPrev30,
        }),
        ciroT90,
        ciroYoy30d,
        fatura30,
        faturaPrev30,
        faturaT90,
        urunGrup30,
        urunGrupPrev30,
        ziyaret90,
        riskScore: score.score,
        riskTierV2: score.tier,
        riskComponents: JSON.stringify(score.components),
        riskReasons: JSON.stringify(score.reasons),
      });
    }
    for (const r of citiesRes.rows) {
      const v = String(r.sehir ?? "").trim();
      if (v) insCity.run(v);
    }
    for (const r of distsRes.rows) {
      const k = Number(r.lngKod);
      const a = String(r.ad ?? "").trim();
      if (Number.isFinite(k) && a) insDist.run(k, a);
    }
  });
  replaceAll();

  const durationMs = Date.now() - startedAt;
  const status: MapSyncStatus = {
    lastSyncAt: new Date().toISOString(),
    durationMs,
    customerCount: customersRes.rows.length,
    cityCount: citiesRes.rows.length,
    distCount: distsRes.rows.length,
  };
  db.prepare(
    `INSERT INTO sync_state (domain, last_sync_at, duration_ms, customer_count, city_count, dist_count)
     VALUES ('map', @lastSyncAt, @durationMs, @customerCount, @cityCount, @distCount)
     ON CONFLICT(domain) DO UPDATE SET
       last_sync_at = excluded.last_sync_at,
       duration_ms  = excluded.duration_ms,
       customer_count = excluded.customer_count,
       city_count = excluded.city_count,
       dist_count = excluded.dist_count`,
  ).run(status);

  // Underlying MSSQL data may have shifted — invalidate every read-through
  // cache that reflects it (customer detail, foresight, komuta). Radar caches
  // stay because they have their own per-radar refresh affordance.
  cachedClear("customer-detail");
  cachedClear("foresight");
  cachedClear("komuta");

  return status;
}

export type CustomerDetail = {
  // Sales
  ciro30: number;
  fatura30: number;
  sonFaturaTarihi: string | null;

  // Visits (from TBLPMPZIYARETBASLIK)
  ziyaret30: number;
  rutIciZiyaret: number;
  rutDisiZiyaret: number;
  sonZiyaretTarihi: string | null;

  // Payments collected during visits (TBLMSDTAHSILAT joined through ZIYARETDETAY)
  // BYTISLEMKODU codes from SP 5190: 100=Nakit, 104=Çek, 108=Senet, 112=KK
  // (paired with iptal codes 102/106/110/114 — only count entries without iptal pair)
  tahsilatNakit: number;
  tahsilatCek: number;
  tahsilatSenet: number;
  tahsilatKK: number;

  // Document counts inside visits (TBLPMPZIYARETDETAY)
  // BYTISLEMKODU 4=Fatura kesildi, 30=İrsaliye, 60=Sipariş
  ziyaretFaturaSayisi: number;
  ziyaretIrsaliyeSayisi: number;
  ziyaretSiparisSayisi: number;
};

// Backwards-compat alias — older code paths used CustomerSales.
export type CustomerSales = CustomerDetail;

/**
 * Single-customer activity lookup — sales, visits, payments, and document
 * counts from the last N days. Four parallel queries against MSSQL; the
 * popup latency is max(four queries) not sum.
 *
 * The visit / payment / document logic mirrors Pernod's report 5190
 * (SSP_RPT_5190_ZIYARET_ANALIZI). Specifically:
 * - A visit is a TBLPMPZIYARETBASLIK row with TRHGIRIS NOT NULL.
 * - Payments live on TBLMSDTAHSILAT, joined into the visit through
 *   TBLPMPZIYARETDETAY.LNGBELGEKOD with BYTISLEMKODU IN (100,104,108,112).
 *   Each transaction code has a paired "iptal" code (+2); we exclude
 *   payments that have an iptal pair on the same belge.
 * - Document codes: 4=Fatura, 30=İrsaliye, 60=Sipariş — same pattern,
 *   each has an iptal counterpart (+2) we exclude.
 */
export async function getCustomerDetail(
  musteriKod: number,
  days = 30,
  options: { forceRefresh?: boolean } = {},
): Promise<CustomerDetail> {
  const id = Math.floor(musteriKod);
  const d = Math.floor(days);

  // Demo tenant — MSSQL yok, SQLite mirror'dan sentezle. Müşteri kartı
  // ziyaret + tahsilat + belge sayılarını gerçekçi şekilde gösterir.
  const tenant = getTenantConfig();
  if (tenant.id === "fmcg-demo") {
    return loadCustomerDetailFromMirror(id, d);
  }

  // Cache v3: bakiye alanları kaldırıldı (TBLTCPMUSTERIBAKIYE proje-bazlı
  // tutarsız bulundu; payment skoru artık sadece tahsilat coverage'tan).
  const cacheKey = `v3:${id}:${d}`;
  const result = await withCache<CustomerDetail>(
    "customer-detail",
    cacheKey,
    () => loadCustomerDetailFromMssql(id, d),
    { forceRefresh: options.forceRefresh },
  );
  return result.value;
}

/**
 * FMCG demo için müşteri detayını SQLite mirror'dan sentezle. Sync sırasında
 * yazılan ciro_30d / fatura_30d / ziyaret_90d / days_since_last_* alanlarından
 * gerçekçi bir CustomerDetail üretir.
 *
 * Sentezlenenler:
 *   - ziyaret30 = ziyaret_90d / 3 (1 aylık pencereye indir)
 *   - rutIci/rutDisi = 80/20 split (sahanın çoğu rota üzerinde)
 *   - tahsilat split: nakit 60% / çek 25% / senet 10% / KK 5% (TR bakkal default)
 *   - belge sayıları: her ziyarette ~1 fatura + 1 irsaliye + 0.5 sipariş
 */
function loadCustomerDetailFromMirror(id: number, _days: number): CustomerDetail {
  const repoRoot = process.cwd();
  const db = getLocalDb(repoRoot);
  const row = db
    .prepare(
      `SELECT ciro_30d, fatura_30d, ziyaret_90d,
              days_since_last_sale, days_since_last_visit
       FROM map_customers WHERE id = ?`,
    )
    .get(id) as
    | {
        ciro_30d: number | null;
        fatura_30d: number | null;
        ziyaret_90d: number | null;
        days_since_last_sale: number | null;
        days_since_last_visit: number | null;
      }
    | undefined;

  if (!row) {
    return emptyCustomerDetail();
  }

  const ciro30 = row.ciro_30d ?? 0;
  const fatura30 = row.fatura_30d ?? 0;
  // ziyaret_90d 90 günlük; 30g penceresine indir.
  const ziyaret30 = Math.round((row.ziyaret_90d ?? 0) / 3);
  const rutIciZiyaret = Math.floor(ziyaret30 * 0.8);
  const rutDisiZiyaret = ziyaret30 - rutIciZiyaret;

  // Tahsilat dağılımı — TR bakkal/market default tipik kompozisyon.
  const tahsilatNakit = Math.round(ciro30 * 0.6);
  const tahsilatCek = Math.round(ciro30 * 0.25);
  const tahsilatSenet = Math.round(ciro30 * 0.1);
  const tahsilatKK = Math.round(ciro30 * 0.05);

  // Belge sayıları: her ziyaret bir fatura + irsaliye, yarısında ek sipariş.
  const ziyaretFaturaSayisi = ziyaret30;
  const ziyaretIrsaliyeSayisi = ziyaret30;
  const ziyaretSiparisSayisi = Math.round(ziyaret30 * 0.5);

  // Tarihler — gün sayısı geri sayarak demo tarihi 2026-04-17'ye göre.
  const demoToday = new Date("2026-04-17T00:00:00Z").getTime();
  const sonFaturaTarihi =
    row.days_since_last_sale !== null
      ? new Date(demoToday - row.days_since_last_sale * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;
  const sonZiyaretTarihi =
    row.days_since_last_visit !== null
      ? new Date(demoToday - row.days_since_last_visit * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : null;

  return {
    ciro30,
    fatura30,
    sonFaturaTarihi,
    ziyaret30,
    rutIciZiyaret,
    rutDisiZiyaret,
    sonZiyaretTarihi,
    tahsilatNakit,
    tahsilatCek,
    tahsilatSenet,
    tahsilatKK,
    ziyaretFaturaSayisi,
    ziyaretIrsaliyeSayisi,
    ziyaretSiparisSayisi,
  };
}

function emptyCustomerDetail(): CustomerDetail {
  return {
    ciro30: 0,
    fatura30: 0,
    sonFaturaTarihi: null,
    ziyaret30: 0,
    rutIciZiyaret: 0,
    rutDisiZiyaret: 0,
    sonZiyaretTarihi: null,
    tahsilatNakit: 0,
    tahsilatCek: 0,
    tahsilatSenet: 0,
    tahsilatKK: 0,
    ziyaretFaturaSayisi: 0,
    ziyaretIrsaliyeSayisi: 0,
    ziyaretSiparisSayisi: 0,
  };
}

async function loadCustomerDetailFromMssql(
  id: number,
  d: number,
): Promise<CustomerDetail> {

  const salesSql = `
    SELECT
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro,
      COUNT(*)                      AS fatura,
      MAX(f.TRHISLEMTARIHI)         AS sonTarih
    FROM dbo.TBLMSDFATURA AS f
    WHERE f.LNGMUSTERIKOD = ${id}
      AND f.TRHISLEMTARIHI >= DATEADD(day, -${d}, GETDATE())
      AND f.BYTTUR  = 0
      AND f.BYTDURUM = 0
  `;

  const visitSql = `
    SELECT
      COUNT(*)                                            AS ziyaret,
      SUM(CASE WHEN z.BYTRUTKODU = 0 THEN 1 ELSE 0 END)   AS rutIci,
      SUM(CASE WHEN z.BYTRUTKODU = 1 THEN 1 ELSE 0 END)   AS rutDisi,
      MAX(z.TRHGIRIS)                                     AS sonZiyaret
    FROM dbo.TBLPMPZIYARETBASLIK AS z
    WHERE z.LNGMUSTERIKOD = ${id}
      AND z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -${d}, GETDATE())
  `;

  const tahsilatSql = `
    SELECT
      ISNULL(SUM(CASE WHEN d.BYTISLEMKODU = 100 THEN t.DBLTUTAR ELSE 0 END), 0) AS nakit,
      ISNULL(SUM(CASE WHEN d.BYTISLEMKODU = 104 THEN t.DBLTUTAR ELSE 0 END), 0) AS cek,
      ISNULL(SUM(CASE WHEN d.BYTISLEMKODU = 108 THEN t.DBLTUTAR ELSE 0 END), 0) AS senet,
      ISNULL(SUM(CASE WHEN d.BYTISLEMKODU = 112 THEN t.DBLTUTAR ELSE 0 END), 0) AS kk
    FROM dbo.TBLPMPZIYARETDETAY    AS d
    INNER JOIN dbo.TBLPMPZIYARETBASLIK AS z ON z.LNGKOD = d.LNGBASLIKKOD
    INNER JOIN dbo.TBLMSDTAHSILAT  AS t ON t.LNGKOD = d.LNGBELGEKOD
    WHERE z.LNGMUSTERIKOD = ${id}
      AND z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -${d}, GETDATE())
      AND d.BYTISLEMKODU IN (100, 104, 108, 112)
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TBLPMPZIYARETDETAY x
        WHERE x.LNGBELGEKOD = d.LNGBELGEKOD
          AND x.BYTISLEMKODU IN (102, 106, 110, 114)
      )
  `;

  const belgeSql = `
    SELECT
      SUM(CASE WHEN d.BYTISLEMKODU = 4 THEN 1 ELSE 0 END)  AS faturaSayi,
      SUM(CASE WHEN d.BYTISLEMKODU = 30 THEN 1 ELSE 0 END) AS irsaliyeSayi,
      SUM(CASE WHEN d.BYTISLEMKODU = 60 THEN 1 ELSE 0 END) AS siparisSayi
    FROM dbo.TBLPMPZIYARETDETAY    AS d
    INNER JOIN dbo.TBLPMPZIYARETBASLIK AS z ON z.LNGKOD = d.LNGBASLIKKOD
    WHERE z.LNGMUSTERIKOD = ${id}
      AND z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -${d}, GETDATE())
      AND d.BYTISLEMKODU IN (4, 30, 60)
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TBLPMPZIYARETDETAY x
        WHERE x.LNGBELGEKOD = d.LNGBELGEKOD
          AND x.BYTISLEMKODU = d.BYTISLEMKODU + 2
      )
  `;

  const [sales, visits, tahsilat, belge] = await Promise.all([
    runReadOnly(salesSql, { limit: 1, timeoutMs: 20_000 }),
    runReadOnly(visitSql, { limit: 1, timeoutMs: 20_000 }),
    runReadOnly(tahsilatSql, { limit: 1, timeoutMs: 30_000 }),
    runReadOnly(belgeSql, { limit: 1, timeoutMs: 20_000 }),
  ]);

  const s = sales.rows[0] ?? {};
  const v = visits.rows[0] ?? {};
  const t = tahsilat.rows[0] ?? {};
  const b = belge.rows[0] ?? {};

  return {
    ciro30: Number(s.ciro ?? 0),
    fatura30: Number(s.fatura ?? 0),
    sonFaturaTarihi: s.sonTarih
      ? new Date(s.sonTarih as string).toISOString()
      : null,

    ziyaret30: Number(v.ziyaret ?? 0),
    rutIciZiyaret: Number(v.rutIci ?? 0),
    rutDisiZiyaret: Number(v.rutDisi ?? 0),
    sonZiyaretTarihi: v.sonZiyaret
      ? new Date(v.sonZiyaret as string).toISOString()
      : null,

    tahsilatNakit: Number(t.nakit ?? 0),
    tahsilatCek: Number(t.cek ?? 0),
    tahsilatSenet: Number(t.senet ?? 0),
    tahsilatKK: Number(t.kk ?? 0),

    ziyaretFaturaSayisi: Number(b.faturaSayi ?? 0),
    ziyaretIrsaliyeSayisi: Number(b.irsaliyeSayi ?? 0),
    ziyaretSiparisSayisi: Number(b.siparisSayi ?? 0),
  };
}

// Old name kept so existing callers (api server route, mcp tools) continue
// to work without a breaking change in this PR. Original signature was
// (musteriKod, distKod, days) — distKod argument is now ignored.
export async function getCustomerSales(
  musteriKod: number,
  _distKod: number | null,
  days = 30,
  options: { forceRefresh?: boolean } = {},
): Promise<CustomerDetail> {
  return getCustomerDetail(musteriKod, days, options);
}

// ---------------------------------------------------------------------------
// Şehir bazlı YoY — /map sayfasının city drill seviyesi için.
// Son 30g vs Geçen yıl aynı 30g (-395..-365 gün) penceresi — Komuta'nın
// fetchRegions'ı ile aynı window. Müşterilerin ciroPrev30'u "önceki ay"
// olduğu için bu data MSSQL'den taze gelir, mirror üzerinden değil.
// ---------------------------------------------------------------------------

export type MapCityYoY = {
  sehir: string;
  /** Diacritic-strip normalize edilmiş — geojson province_norm ile eşleştirmek için */
  sehirNorm: string;
  ciro: number;
  ciroPrev: number;
  deltaPct: number | null;
};

/** Şehir bazlı YoY (son 30g vs geçen yıl aynı 30g). region parametresi
 *  JS tarafında master JSON ile filtre uygular; verilmezse tüm 81 il döner.
 *
 *  SQL'de bölge filter'i YOK — Türkçe karakter (Çorum/Kayseri/İçel)
 *  MSSQL UPPER() + LIKE pattern'i ile uyumsuz, eşleşmeyen şehirler düşerdi.
 *  81 il agregasyonu ucuz, tüm illeri hesaplayıp JS'de filtre etmek
 *  daha sağlam. */
export async function listMapCityYoY(
  region?: string,
  allowedDistKods?: number[] | null,
): Promise<MapCityYoY[]> {
  const master = await loadRegionMaster();
  if (region && !master.byRegion.has(region)) {
    // Bilinmeyen region adı → boş döner
    return [];
  }

  const scope = scopeFromAllowed(allowedDistKods);
  const distClause = distFilterClause(scope, "f.LNGDISTKOD");

  const sql = `
    WITH son AS (
      SELECT m.TXTSEHIR AS sehir, SUM(f.DBLNETTUTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        AND m.TXTSEHIR IS NOT NULL AND m.TXTSEHIR <> ''
        ${distClause}
      GROUP BY m.TXTSEHIR
    ),
    onceki AS (
      SELECT m.TXTSEHIR AS sehir, SUM(f.DBLNETTUTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
        AND m.TXTSEHIR IS NOT NULL AND m.TXTSEHIR <> ''
        ${distClause}
      GROUP BY m.TXTSEHIR
    )
    SELECT COALESCE(s.sehir, o.sehir) AS sehir,
           ISNULL(s.ciro, 0) AS ciro,
           ISNULL(o.ciro, 0) AS ciroPrev
    FROM son s
    FULL OUTER JOIN onceki o ON o.sehir = s.sehir
  `;
  const out = await runReadOnly(sql, { limit: 500, timeoutMs: 60_000 });
  console.info(
    `[map city-yoy] SQL ${out.rows.length} ham şehir döndü (region filter JS'de uygulanacak: ${region ?? "yok"})`,
  );

  // Customer.sehir → master province_norm match (Komuta'nın matchProvince
  // mantığı ile aynı). Birden fazla raw sehir aynı province'a düşerse
  // toplama yapılır.
  const matchProvince = (raw: string): string | null => {
    const norm = raw
      .replace(/İ/g, "I").replace(/ı/g, "I").replace(/I/g, "I").replace(/i/g, "I")
      .replace(/Ş/g, "S").replace(/ş/g, "S")
      .replace(/Ğ/g, "G").replace(/ğ/g, "G")
      .replace(/Ü/g, "U").replace(/ü/g, "U")
      .replace(/Ö/g, "O").replace(/ö/g, "O")
      .replace(/Ç/g, "C").replace(/ç/g, "C")
      .toUpperCase().trim();
    if (!norm) return null;
    if (master.byProvince.has(norm)) return norm;
    const firstToken = norm.split(/[\s\-_./]+/)[0];
    if (firstToken && master.byProvince.has(firstToken)) return firstToken;
    for (const p of master.byProvince.keys()) {
      if (p && norm.includes(p)) return p;
    }
    return null;
  };

  const byProvince = new Map<string, { ciro: number; ciroPrev: number; rawSehir: string }>();
  const unmatched: string[] = [];
  const droppedByRegion: string[] = [];
  for (const row of out.rows) {
    const raw = String(row.sehir ?? "").trim();
    if (!raw) continue;
    const matched = matchProvince(raw);
    if (!matched) {
      unmatched.push(raw);
      continue;
    }
    // ALIAS → KANONİK: master "AFYONKARAHISAR" diye match etse de geojson
    // sadece "AFYON" polygon'u taşıyor; canonicalProvince ile mapler.
    const province = canonicalProvince(matched);
    // İstenen bölgenin dışındaki şehirler düşür
    if (region) {
      const info = master.byProvince.get(province);
      if (!info || info.region !== region) {
        droppedByRegion.push(`${raw} → ${province} (${info?.region ?? "?"})`);
        continue;
      }
    }
    const e = byProvince.get(province) ?? {
      ciro: 0,
      ciroPrev: 0,
      rawSehir: raw,
    };
    e.ciro += Number(row.ciro ?? 0);
    e.ciroPrev += Number(row.ciroPrev ?? 0);
    byProvince.set(province, e);
  }
  console.info(
    `[map city-yoy] Sonuç: ${byProvince.size} il match etti${region ? ` (region=${region})` : ""}, ${unmatched.length} eşleşmeyen, ${droppedByRegion.length} bölge dışı`,
  );
  if (unmatched.length > 0) {
    console.warn(
      `[map city-yoy] Eşleşmeyen şehirler (master JSON'a eklenmeli):`,
      unmatched.slice(0, 10).join(", "),
    );
  }
  if (region && byProvince.size === 0) {
    console.error(
      `[map city-yoy] ${region} için HİÇBİR şehir eşleşmedi — bölge dışı dropped örnekleri:`,
      droppedByRegion.slice(0, 5).join(" | "),
    );
  }

  return Array.from(byProvince.entries()).map(([provNorm, agg]) => ({
    sehir: agg.rawSehir,
    sehirNorm: provNorm,
    ciro: agg.ciro,
    ciroPrev: agg.ciroPrev,
    deltaPct:
      agg.ciroPrev > 0
        ? ((agg.ciro - agg.ciroPrev) / agg.ciroPrev) * 100
        : null,
  }));
}
