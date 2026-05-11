// Mirror of describeRiskReason() in packages/core/src/map.ts.
// Kept here so client components can call it without pulling the core
// package into the bundle. If you change one, change both.

import type { MapCustomer } from "./api";

export function describeRiskReason(c: MapCustomer): string {
  const dSale = c.daysSinceLastSale;
  const dVisit = c.daysSinceLastVisit;
  const ciro30 = c.ciro30;
  const ciroPrev30 = c.ciroPrev30;
  const fmt = (n: number) => Math.round(n).toLocaleString("tr-TR") + " ₺";
  const hasAnyHistory =
    ciro30 > 0 || ciroPrev30 > 0 || (dSale !== null && dSale < 365);

  if (c.riskTier === "high") {
    if (dSale === null) return "";
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

  if (c.riskTier === "medium") {
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

  if (c.riskTier === "active") {
    return `Son ${dSale ?? "?"} gün içinde satış oldu, ciro sağlıklı`;
  }

  if (dSale === null) return "Hiç sipariş kaydı yok";
  if (dSale >= 180) return `${dSale} gündür hiç sipariş yok`;
  return "Düşük öncelik";
}
