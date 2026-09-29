import { describe, expect, it } from "vitest";
import { computeVisitOrderRisk, type VisitOrderRiskCfg } from "../map.js";

/**
 * "visit-order" risk modeli (Faz A2, madde 13) — saf fonksiyon, DB'ye
 * dokunmaz. 4 tier × 2 öncelik (visit/order) kombinasyonlarını doğrular.
 */
describe("computeVisitOrderRisk", () => {
  const visitPriorityCfg: VisitOrderRiskCfg = {
    priority: "visit",
    riskTiers: ["red", "orange"],
    windowDays: 30,
  };
  const orderPriorityCfg: VisitOrderRiskCfg = {
    priority: "order",
    riskTiers: ["red", "orange"],
    windowDays: 30,
  };

  // ---- 4 tier (priority: visit) -------------------------------------------

  it("red — ziyaret YOK + sipariş YOK (ikisi de pencerede yok)", () => {
    const r = computeVisitOrderRisk(
      { daysSinceLastVisit: 45, daysSinceLastOrder: null },
      visitPriorityCfg,
    );
    expect(r.tier).toBe("red");
    expect(r.score).toBe(100);
    expect(r.isRisk).toBe(true);
    expect(r.reason).toBe("30g içinde ziyaret YOK, sipariş YOK");
  });

  it("orange — ziyaret YOK + sipariş VAR", () => {
    const r = computeVisitOrderRisk(
      { daysSinceLastVisit: 40, daysSinceLastOrder: 10 },
      visitPriorityCfg,
    );
    expect(r.tier).toBe("orange");
    expect(r.isRisk).toBe(true);
    expect(r.reason).toBe("30g içinde ziyaret YOK, sipariş var");
  });

  it("yellow — ziyaret VAR + sipariş YOK", () => {
    const r = computeVisitOrderRisk(
      { daysSinceLastVisit: 5, daysSinceLastOrder: 90 },
      visitPriorityCfg,
    );
    expect(r.tier).toBe("yellow");
    expect(r.isRisk).toBe(false); // riskTiers = ["red","orange"] → yellow risk sayılmaz
    expect(r.reason).toBe("30g içinde ziyaret var, sipariş YOK");
  });

  it("green — ikisi de VAR (pencere sınırında dahil, <=)", () => {
    const r = computeVisitOrderRisk(
      { daysSinceLastVisit: 30, daysSinceLastOrder: 1 },
      visitPriorityCfg,
    );
    expect(r.tier).toBe("green");
    expect(r.score).toBe(0);
    expect(r.isRisk).toBe(false);
    expect(r.reason).toBe("30g içinde ziyaret var, sipariş var");
  });

  it("null günler = hiç kayıt yok → her zaman 'yok' sayılır (red)", () => {
    const r = computeVisitOrderRisk(
      { daysSinceLastVisit: null, daysSinceLastOrder: null },
      visitPriorityCfg,
    );
    expect(r.tier).toBe("red");
    expect(r.score).toBe(100);
  });

  // ---- Öncelik swap (priority: "order") — TIER SABİT, SKOR AĞIRLIĞI DEĞİŞİR --

  it("priority=order — orange (ziyaret YOK+sipariş VAR) skoru DÜŞER (ikincil sinyal)", () => {
    const r = computeVisitOrderRisk(
      { daysSinceLastVisit: 40, daysSinceLastOrder: 10 },
      orderPriorityCfg,
    );
    expect(r.tier).toBe("orange"); // tier öncelikten BAĞIMSIZ
    expect(r.score).toBe(40); // visit ikincil sinyal (w2=0.4) oldu
  });

  it("priority=order — yellow (ziyaret VAR+sipariş YOK) skoru YÜKSELİR (birincil sinyal)", () => {
    const r = computeVisitOrderRisk(
      { daysSinceLastVisit: 5, daysSinceLastOrder: 90 },
      orderPriorityCfg,
    );
    expect(r.tier).toBe("yellow"); // tier öncelikten BAĞIMSIZ
    expect(r.score).toBe(60); // order birincil sinyal (w1=0.6) oldu
  });

  it("priority=visit varsayılanında aynı orange/yellow skorları TERSİNE döner", () => {
    const orange = computeVisitOrderRisk(
      { daysSinceLastVisit: 40, daysSinceLastOrder: 10 },
      visitPriorityCfg,
    );
    const yellow = computeVisitOrderRisk(
      { daysSinceLastVisit: 5, daysSinceLastOrder: 90 },
      visitPriorityCfg,
    );
    expect(orange.score).toBe(60); // visit birincil (w1=0.6)
    expect(yellow.score).toBe(40); // order ikincil (w2=0.4)
  });

  // ---- riskTiers override → isRisk -----------------------------------------

  it("riskTiers genişletilirse (ör. yellow eklenirse) isRisk buna göre değişir", () => {
    const cfg: VisitOrderRiskCfg = {
      priority: "visit",
      riskTiers: ["red", "orange", "yellow"],
      windowDays: 30,
    };
    const r = computeVisitOrderRisk(
      { daysSinceLastVisit: 5, daysSinceLastOrder: 90 },
      cfg,
    );
    expect(r.tier).toBe("yellow");
    expect(r.isRisk).toBe(true);
  });
});
