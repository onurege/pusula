/**
 * Komuta sayfası shared format helper'ları. Hem V1 hem V2 panellerinden
 * tekrar tekrar kopyalanmasın diye burada tek noktada.
 */

import type { KomutaKpiCard, KomutaMatrixRow, ValueUnit } from "@/lib/api";

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "Mr";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toString();
}

/** Snapshot.unit'e göre kısa birim etiketi. UI'da küçük/silik gösterilir. */
export function unitSuffix(unit: ValueUnit): string {
  return unit === "9le" ? "9L" : "₺";
}

/** Compact + suffix tek-string. Recharts tooltip / aria-label gibi text-only
 *  yerler için (JSX'in çalışmadığı bağlamlar). */
export function formatValue(n: number, unit: ValueUnit): string {
  return `${formatCompact(n)} ${unitSuffix(unit)}`;
}

/** Görsel formatlama — sayı normal boy, birim küçük + silik bir span olarak
 *  yan yana. Sayıyla suffix'in görsel olarak karışmasını engeller.
 *
 *  Kullanım: `<Val n={row.buAy} unit={unit} />` — `<td>` veya başka inline
 *  container'da doğrudan yerleştirilebilir. */
export function Val({
  n,
  unit,
}: {
  n: number;
  unit: ValueUnit;
}) {
  return (
    <>
      {formatCompact(n)}
      <span
        style={{
          fontSize: "0.72em",
          opacity: 0.55,
          fontWeight: 500,
          marginLeft: "0.32em",
          letterSpacing: "0.02em",
        }}
      >
        {unitSuffix(unit)}
      </span>
    </>
  );
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function formatKpi(k: KomutaKpiCard): string {
  if (k.format === "currency") {
    return `${Math.round(k.value).toLocaleString("tr-TR")} ${k.unit ?? ""}`.trim();
  }
  if (k.format === "compact") {
    return `${formatCompact(k.value)} ${k.unit ?? ""}`.trim();
  }
  if (k.format === "percent") {
    return `%${k.value.toFixed(1)}`;
  }
  // count — büyük sayılarda binlik ayırıcı; varsa unit (örn. "9L") eklenir
  const formatted = Math.round(k.value).toLocaleString("tr-TR");
  return k.unit ? `${formatted} ${k.unit}` : formatted;
}

/** KPI değerini JSX olarak göster — sayı tam boy, birim (₺ / 9L) belirgin
 *  şekilde küçük + silik, böylece "2.8 Mr ₺" değil "2.8 Mr ₺"
 *  görünür. Sayıyla suffix birbirine karışmaz. */
export function KpiValue({ k }: { k: KomutaKpiCard }) {
  if (k.format === "percent") {
    return <>%{k.value.toFixed(1)}</>;
  }
  const numStr =
    k.format === "compact"
      ? formatCompact(k.value)
      : Math.round(k.value).toLocaleString("tr-TR");
  return (
    <>
      {numStr}
      {k.unit && (
        <span
          style={{
            fontSize: "0.55em",
            opacity: 0.55,
            fontWeight: 500,
            marginLeft: "0.32em",
            letterSpacing: "0.02em",
            verticalAlign: "0.18em",
          }}
        >
          {k.unit}
        </span>
      )}
    </>
  );
}

export function trendEmoji(t: KomutaMatrixRow["trend"]): string {
  if (t === "rocket") return "🚀";
  if (t === "up") return "📈";
  if (t === "down") return "📉";
  return "📊";
}

export function formatRelative(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "az önce";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}
