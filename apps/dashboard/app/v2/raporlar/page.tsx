import Link from "next/link";
import { PagePlaceholder } from "@/components/v2/PagePlaceholder";

export const metadata = { title: "Raporlar · V2 · Enroute Pusula" };

/**
 * V2 Raporlar sekmesi — Raporlar + Yeni Rapor + Şema buraya konsolide.
 * Faz A'da mevcut sayfalara link; Faz B'de tek tab-arayüzünde birleşir.
 */
export default function V2RaporlarPage() {
  return (
    <div className="space-y-4">
      <PagePlaceholder
        eyebrow="Raporlar"
        title="Raporlar + BI + Şema"
        description="V1'deki ayrı 3 sekme (Raporlar / Yeni rapor / Şema) tek sayfa üst-tab yapısına konsolide olacak. Faz A'da mevcut sayfalara link."
        comingSoon={[
          "Liste: kayıtlı raporlar",
          "Yeni rapor: Gemini destekli SQL üretici",
          "Şema gezgini (TBLMUSTERI / TBLMSDFATURA / TBLURUN ...)",
          "Çalıştırma geçmişi + son N koşu sonucu",
          "Rapor → Komuta dashboard'a embed butonu (yeni)",
        ]}
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Link
          href="/reports"
          className="rounded-lg border border-border bg-surface hover:border-accent/40 hover:shadow-sm transition-all p-4 text-sm"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">
            Mevcut sayfa
          </div>
          <div className="font-semibold">Raporlar listesi</div>
          <div className="text-xs text-muted mt-1">/reports</div>
        </Link>
        <Link
          href="/reports/new"
          className="rounded-lg border border-border bg-surface hover:border-accent/40 hover:shadow-sm transition-all p-4 text-sm"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">
            Mevcut sayfa
          </div>
          <div className="font-semibold">Yeni rapor üret</div>
          <div className="text-xs text-muted mt-1">/reports/new</div>
        </Link>
        <Link
          href="/schema"
          className="rounded-lg border border-border bg-surface hover:border-accent/40 hover:shadow-sm transition-all p-4 text-sm"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">
            Mevcut sayfa
          </div>
          <div className="font-semibold">Şema gezgini</div>
          <div className="text-xs text-muted mt-1">/schema</div>
        </Link>
      </div>
    </div>
  );
}
