"use client";

import Link from "next/link";
import { CustomerBreakdownSection } from "./CustomerBreakdownSection";
import { ProductBreakdownSection } from "./ProductBreakdownSection";
import { RegionBreakdownSection } from "./RegionBreakdownSection";
import { TenantIdentitySection } from "./TenantIdentitySection";
import { DbConnectionSection } from "./DbConnectionSection";
import { DatabasesSection } from "./DatabasesSection";

/**
 * Admin · Insider Konfigüratörü (Faz A Dalga 3, Faz B Dalga 2, Faz A Dalga 1
 * tenant kimliği) — sayfa kabuğu.
 *
 * Beş bağımsız bölümü (müşteri/ürün/bölge kırılımı — `BreakdownSection`
 * üzerinden boyut-parametreli — `TenantIdentitySection` ve
 * `DbConnectionSection`) bir araya getirir; her biri kendi veri/durum
 * yönetimini taşır (bkz. o dosyaların üst yorumu). Ortak stil sınıfları
 * (`ik-*`) burada, tek yerde.
 *
 * "use client" + metadata export YOK — `<style jsx>` bu depoda yalnız Client
 * Component'lerde kanıtlı (bkz. `app/admin/yetkiler/page.tsx`); kök layout'ta
 * styled-jsx style-registry kurulmadığı için Server Component içinde
 * kullanmak Next'in resmi desteğinin dışına çıkar (bkz. Next.js CSS-in-JS
 * rehberi — styled-jsx yalnız Client Component'lerde desteklenir).
 */
export default function InsiderKonfiguratorPage() {
  return (
    <div className="v3-page" style={{ padding: "4px 0 24px" }}>
      <header style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--color-border)" }}>
        <div
          style={{
            fontSize: 10.5, fontWeight: 600, color: "var(--color-accent)",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}
        >
          Admin · Insider Konfigüratörü
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: "var(--color-fg)", letterSpacing: "-0.025em", margin: "4px 0 6px" }}>
          Kırılım Eşlemeleri, Tenant Kimliği &amp; DB Bağlantısı
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--color-muted)", margin: 0, maxWidth: 720 }}>
          Kodu değiştirmeden müşteri, ürün ve bölge kırılımlarında hangi
          tabloyu, hangi MSSQL hedefini kullanacağını; kodsuz tenant'lar için
          ad/marka/metin kimliğini buradan ayarla. Kayıt öncesi her bölüm
          doğrulama yapar — bozuk bir tanım diske yazılmaz.
        </p>
        <Link href="/admin" className="ik-link">← İçerik yönetimine dön</Link>
      </header>

      <CustomerBreakdownSection />
      <ProductBreakdownSection />
      <RegionBreakdownSection />
      <TenantIdentitySection />
      <DbConnectionSection />
      <DatabasesSection />

      <style jsx global>{`
        .ik-link { font-size: 12.5px; color: var(--color-accent); }
        .ik-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
        .ik-h2 { font-size: 15px; font-weight: 600; color: var(--color-fg); margin: 0 0 4px; }
        .ik-sub { font-size: 12.5px; color: var(--color-muted); margin: 0 0 14px; max-width: 640px; line-height: 1.5; }
        .ik-muted { font-size: 12.5px; color: var(--color-muted); }
        .ik-field { display: flex; flex-direction: column; gap: 4px; }
        .ik-label { font-size: 12px; font-weight: 500; color: var(--color-fg-2); }
        .ik-input { width: 100%; box-sizing: border-box; padding: 8px 11px; font-size: 13px; color: var(--color-fg); font-family: inherit; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 7px; }
        .ik-input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
        .ik-input:disabled { opacity: .6; cursor: not-allowed; }
        .ik-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
        .ik-btn.primary { background: var(--color-accent); color: var(--color-accent-fg); }
        .ik-btn.ghost { background: transparent; color: var(--color-muted); border-color: var(--color-border); }
        .ik-btn:disabled { opacity: .5; cursor: not-allowed; }
        .ik-btn:focus-visible, .ik-cand:focus-visible, .ik-input:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
        .ik-msg { font-size: 12.5px; font-weight: 500; }
        .ik-msg.good { color: var(--color-good); }
        .ik-msg.bad { color: var(--color-bad); }
        .ik-badge { font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px; }
        .ik-badge.good { color: var(--color-good); background: var(--color-good-soft); }
        .ik-badge.warn { color: var(--color-warn); background: var(--color-warn-soft); }
        .ik-badge.bad { color: var(--color-bad); background: var(--color-bad-soft); }
        .ik-badge.neutral { color: var(--color-muted); background: var(--color-surface-2); }
        .ik-current { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface-2); margin-bottom: 16px; }
        .ik-current-src { font-family: var(--font-mono); font-size: 12.5px; color: var(--color-fg); }
        .ik-cand-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
        .ik-cand { text-align: left; width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-bg); cursor: pointer; }
        .ik-cand:hover:not(:disabled) { border-color: var(--color-accent); }
        .ik-cand[aria-pressed="true"] { border-color: var(--color-accent); box-shadow: 0 0 0 1px var(--color-accent); }
        .ik-cand:disabled { cursor: default; opacity: .85; }
        .ik-cand-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .ik-cand-name { font-size: 13.5px; font-weight: 600; color: var(--color-fg); }
        .ik-cand-src { font-family: var(--font-mono); font-size: 11px; color: var(--color-muted); }
        .ik-cand-desc { font-size: 12px; color: var(--color-muted); line-height: 1.4; margin: 0; }
        .ik-preview { border: 1px solid var(--color-border); border-radius: 9px; padding: 14px 16px; background: var(--color-surface-2); margin-bottom: 14px; }
        .ik-samples { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
        .ik-chip { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-fg-2); }
        .ik-rate-bar { height: 6px; border-radius: 999px; background: var(--color-surface-3); overflow: hidden; margin-top: 6px; }
        .ik-rate-fill { height: 100%; border-radius: 999px; }
        .ik-rate-fill.good { background: var(--color-good); }
        .ik-rate-fill.warn { background: var(--color-warn); }
        .ik-rate-fill.bad { background: var(--color-bad); }
        .ik-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
        .ik-actions-left { margin-right: auto; }
        .ik-grid2 { display: grid; grid-template-columns: 1fr; gap: 14px; }
        @media (min-width: 720px) { .ik-grid2 { grid-template-columns: 1fr 1fr; } }
        .ik-help { font-size: 11.5px; color: var(--color-muted); margin-top: 4px; line-height: 1.4; }
        .ik-skeleton { height: 14px; border-radius: 4px; background: var(--color-surface-2); animation: ik-pulse 1.4s ease-in-out infinite; }
        @keyframes ik-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
      `}</style>
    </div>
  );
}
