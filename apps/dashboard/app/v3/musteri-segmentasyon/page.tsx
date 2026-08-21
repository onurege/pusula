import { getWietnauerSegment } from "@/lib/api";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import {
  EkSahaPanel,
  type EkSahaSegmentRow,
} from "@/components/v3/segment/EkSahaPanel";
import {
  EkGrupPanel,
  type EkGrupSegmentRow,
} from "@/components/v3/segment/EkGrupPanel";
import {
  SegmentBrandCrossPanel,
  type SegmentBrandCell,
} from "@/components/v3/segment/SegmentBrandCrossPanel";

export const metadata = { title: "Müşteri Segmentasyon · V3 · Insider" };

type SegmentSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  ekSaha: EkSahaSegmentRow[];
  ekGrup: EkGrupSegmentRow[];
  cross: {
    tipler: string[];
    markalar: string[];
    cells: SegmentBrandCell[];
  };
};

/**
 * V3 Dashboard #3 — Müşteri Segmentasyon.
 *
 * Üç bağımsız segment boyutu yan yana + altta cross-segment heatmap.
 *
 *   A) Müşteri Tipi (Ek Saha 8)
 *   B) Müşteri Ek Grubu (bayilik formatı)
 *   C) Cirosal Segment (Wietnauer'da boş olabilir → empty state)
 *   D) Cross: Müşteri Tipi × Marka heatmap
 *
 * Layout: lg breakpoint'te 3 sütun, sm'de tek sütun. Cross panel her zaman
 * tam genişlikte altta.
 */
export default async function V3MusteriSegmentasyonPage() {
  let snap: SegmentSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerSegment<SegmentSnapshot>();
  } catch (e) {
    err = (e as Error).message;
  }

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 03"
        title="Müşteri Segmentasyon"
        description="Müşteri Tipi (Ek Saha), Ek Grubu (bayilik formatı) ve Cirosal Segment — üç bağımsız boyut son 30 günlük ciro üzerinden yan yana. Altta Tip × Marka heatmap'i kanal-bazlı odaklanmayı gösterir."
        dataNote="TBLMUSTERIEKSAHA · TBLMUSTERIEKGRUP · TBLCIROSALSEGMENTMUSTERI · TBLURUNGRUP"
        generatedAt={snap?.generatedAt}
      />

      {err && (
        <div className="v3-error">
          <strong>Veri alınamadı:</strong> {err}
          <div className="v3-error-hint">
            VPN kontrol et veya MSSQL bağlantı durumunu doğrula.
          </div>
        </div>
      )}

      {snap && (
        <>
          {/* Üst sıra: 3 bağımsız segment boyutu yan yana. */}
          {/* md32: cirosal segment kaldırıldı → 2 kırılım (md24'te 3'e çıkacak). */}
          <div className="seg-triple-grid">
            <EkSahaPanel rows={snap.ekSaha} />
            <EkGrupPanel rows={snap.ekGrup} />
          </div>

          {/* Alt sıra: tam genişlik cross-segment heatmap. */}
          <div className="seg-cross-wrap">
            <SegmentBrandCrossPanel data={snap.cross} />
          </div>
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .seg-triple-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }
        @media (min-width: 1080px) {
          .seg-triple-grid {
            grid-template-columns: repeat(3, 1fr);
            align-items: start;
          }
        }
        .seg-cross-wrap {
          display: block;
        }
        .v3-error {
          background: var(--color-bad-bg, rgba(220, 38, 38, 0.05));
          border: 1px solid var(--color-bad, #dc2626);
          border-radius: 8px;
          padding: 14px 16px;
          margin-bottom: 20px;
          font-size: 13px;
          color: var(--color-fg);
        }
        .v3-error-hint {
          margin-top: 4px;
          font-size: 12px;
          color: var(--color-muted);
        }
      `,
        }}
      />
    </div>
  );
}
