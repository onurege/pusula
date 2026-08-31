"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { KomutaFacets } from "@/lib/api";

/**
 * md2 — Cockpit global filtre dropdown'ları: Bölge + Kanal. Seçim URL'e
 * (`?bolge&kanal`) yazılır, sayfa RSC olarak yeniden render olur ve seçim
 * `getKomutaSnapshot` opts'una akıp TÜM panellere (Kanal Mix trendi dahil)
 * uygulanır. Diğer query param'ları (reel/otv/unit) korunur.
 */
export function KomutaFilterDropdowns({
  facets,
  bolge,
  kanal,
  urunGrup,
}: {
  facets: KomutaFacets;
  bolge: string | null;
  kanal: string | null;
  urunGrup: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParam(key: string, val: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (!val || val === "__all__") params.delete(key);
    else params.set(key, val);
    const qs = params.toString();
    startTransition(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  return (
    <>
      <label className={`kf-chip${bolge ? " on" : ""}`}>
        <span className="kf-lbl">Bölge</span>
        <select
          value={bolge ?? "__all__"}
          onChange={(e) => setParam("bolge", e.target.value)}
          disabled={isPending}
        >
          <option value="__all__">Tümü</option>
          {facets.bolgeler.map((b) => (
            <option key={b.kod} value={b.kod}>{b.ad}</option>
          ))}
        </select>
      </label>

      <label className={`kf-chip${kanal ? " on" : ""}`}>
        <span className="kf-lbl">Grup Kırılımı</span>
        <select
          value={kanal ?? "__all__"}
          onChange={(e) => setParam("kanal", e.target.value)}
          disabled={isPending}
        >
          <option value="__all__">Tümü</option>
          {facets.kanallar.map((k) => (
            <option key={k.kod} value={k.kod}>{k.ad}</option>
          ))}
        </select>
      </label>

      <label className={`kf-chip${urunGrup ? " on" : ""}`}>
        <span className="kf-lbl">Ürün Grubu</span>
        <select
          value={urunGrup ?? "__all__"}
          onChange={(e) => setParam("urunGrup", e.target.value)}
          disabled={isPending}
        >
          <option value="__all__">Tümü</option>
          {facets.urunGruplari.map((u) => (
            <option key={u.kod} value={u.kod}>{u.ad}</option>
          ))}
        </select>
      </label>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .kf-chip {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 10px; border-radius: 999px;
          background: var(--color-surface-2, #f4f4f5);
          border: 1px solid var(--color-border, #e4e4e7);
          font-size: 12.5px; cursor: pointer;
        }
        .kf-chip.on { border-color: var(--color-accent); background: var(--color-accent-soft, #eef); }
        .kf-chip .kf-lbl { font-weight: 600; color: var(--color-muted); }
        .kf-chip select {
          border: none; background: transparent; font-family: inherit;
          font-size: 12.5px; color: var(--color-fg); cursor: pointer; outline: none;
          max-width: 180px;
        }
        .kf-chip select:disabled { opacity: 0.6; cursor: wait; }
      `,
        }}
      />
    </>
  );
}
