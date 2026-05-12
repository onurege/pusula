import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

export const dynamic = "force-static";
export const metadata = {
  title: "Komuta Köprüsü · UNIQUE AI Reports",
};

/**
 * Komuta Köprüsü — CEO/Satış Direktörü görünümü.
 *
 * Stage 1: mockup HTML public/ üzerinden iframe ile servisi yapılıyor. Görsel
 * sadakat birinci öncelik (firma onayladı). Aşama 2'de mockup'ın her bölümü
 * gerçek Univera verisi ile beslenecek — KPI strip, bölge haritası, marka
 * matrisi, takvim şeridi gibi alanlar mevcut backend'imizden çekilebilir.
 *
 * Bu sayfa kendi tam-ekran layout'unu kullanır — global navbar gizlenir
 * (immersive CEO view). Üst kısımdaki ince çubuk geri dönüş + demo veri
 * uyarısını taşır.
 */
export default function KomutaPage() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d1117]">
      {/* Minimal command bar — geri dön + demo veri rozeti */}
      <div className="h-9 px-4 flex items-center justify-between text-xs bg-[#0d1117] border-b border-[#30363d] text-[#8b949e] shrink-0">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[#8b949e] hover:text-[#d4a857] transition-colors"
        >
          <ArrowLeft size={12} />
          Enroute Pusula'ya dön
        </Link>
        <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#d4a857]">
          <Sparkles size={11} />
          Demo veri · canlı bağlantı v2'de
        </div>
      </div>

      {/* Mockup iframe — sandbox to prevent ANY scripts (mockup is static anyway) */}
      <iframe
        src="/komuta-mockup.html"
        title="Komuta Köprüsü"
        className="flex-1 w-full border-0 bg-[#0d1117]"
        sandbox="allow-same-origin"
      />
    </div>
  );
}
