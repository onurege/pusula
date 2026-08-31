import { getWietnauerSegment } from "@/lib/api";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { GlobalDonemFilter } from "@/components/v3/GlobalDonemFilter";
import { donemLabel } from "@/lib/donem";
import {
  MusteriGrupPanel,
  type MusteriGrupSegmentRow,
} from "@/components/v3/segment/MusteriGrupPanel";
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
import {
  IskontoBreakdownPanel,
  type EkGrupIskontoRow,
  type MusteriIskontoRow,
} from "@/components/v3/segment/IskontoBreakdownPanel";

export const metadata = { title: "Müşteri Segmentasyon · V3 · Insider" };

type SegmentSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  musteriGrubu: MusteriGrupSegmentRow[];
  ekGrup: EkGrupSegmentRow[];
  ekSaha: EkSahaSegmentRow[];
  ekGrupIskonto: EkGrupIskontoRow[];
  musteriIskonto: MusteriIskontoRow[];
  cross: {
    tipler: string[];
    markalar: string[];
    cells: SegmentBrandCell[];
  };
};

/**
 * V3 Dashboard #3 — Müşteri Segmentasyon.
 *
 * Üç bağımsız segment boyutu yan yana + altta cross-segment heatmap
 * + iskonto kırılımı (md35).
 *
 *   A) Müşteri Grubu — Müşteri Grup Kırılımı (TBLMUSTERIGRUPKIRILIM)
 *   B) Müşteri Ek Grubu (bayilik formatı)
 *   C) Müşteri Tipi — A) ile AYNI kaynak (Müşteri Grup Kırılımı)
 *   D) Cross: Müşteri Tipi × Marka heatmap
 *   E) İskonto Kırılımı: Ek Grup / nokta (müşteri) bazında (md35)
 *
 * Cirosal segment (Wietnauer'da genelde boş) md32'den beri sayfada
 * gösterilmiyor; snapshot'ta hâlâ mevcut ama burada tüketilmiyor.
 *
 * Layout: lg breakpoint'te 3 sütun, sm'de tek sütun. Cross panel ve iskonto
 * kırılım paneli her zaman tam genişlikte altta.
 */
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  searchParams: Promise<{ donem?: string; from?: string; to?: string }>;
};

export default async function V3MusteriSegmentasyonPage({ searchParams }: Props) {
  const sp = await searchParams;
  const dateFrom = sp.from && ISO_DATE_RX.test(sp.from) ? sp.from : null;
  const dateTo = sp.to && ISO_DATE_RX.test(sp.to) ? sp.to : null;
  const donem = dateFrom && dateTo ? null : (sp.donem ?? "").toLowerCase() || null;
  let snap: SegmentSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerSegment<SegmentSnapshot>({ dateFrom, dateTo, donem });
  } catch (e) {
    err = (e as Error).message;
  }

  // madde 7: statik açıklama yerine snapshot'tan gelen gerçek sayılar
  // (kırılım sayısı, toplam müşteri, ek grup sayısı) — uydurma değer yok.
  const donemTxt = donemLabel(donem, dateFrom, dateTo);
  const kirilimSayisi = snap?.musteriGrubu.length ?? 0;
  const ekGrupSayisi = snap?.ekGrup.length ?? 0;
  const toplamMusteriSayisi = snap
    ? snap.musteriGrubu.reduce((acc, r) => acc + r.musteriSayi, 0)
    : 0;
  const description = snap
    ? `Müşteri Grubu ve Müşteri Tipi, Müşteri Grup Kırılımı kaynağından (${kirilimSayisi} kırılım, ${toplamMusteriSayisi.toLocaleString("tr-TR")} müşteri); Ek Grubu (bayilik formatı, ${ekGrupSayisi} grup) ayrı boyut — ${donemTxt} ciro üzerinden yan yana. Altta Tip × Marka heatmap'i ve Ek Grup / nokta bazında iskonto kırılımı.`
    : `Müşteri Grubu, Ek Grubu (bayilik formatı) ve Müşteri Tipi — üç bağımsız boyut ${donemTxt} ciro üzerinden yan yana. Altta Tip × Marka heatmap'i ve Ek Grup / nokta bazında iskonto kırılımı.`;

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 03"
        title="Müşteri Segmentasyon"
        contentKey="page.segment.title"
        descKey="page.segment.desc"
        description={description}
        dataNote="TBLMUSTERIGRUPKIRILIM · TBLMUSTERIEKGRUP · TBLMUSTERIGRUP (Tip×Marka) · TBLURUNGRUP · TBLMSDFATURA.DBLISKONTOTUTARI"
        generatedAt={snap?.generatedAt}
      />

      <GlobalDonemFilter />

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
          {/* Üst sıra: 3 bağımsız segment boyutu yan yana (md24). */}
          <div className="seg-triple-grid">
            <MusteriGrupPanel rows={snap.musteriGrubu} />
            <EkGrupPanel rows={snap.ekGrup} />
            <EkSahaPanel rows={snap.ekSaha} />
          </div>

          {/* Alt sıra: tam genişlik cross-segment heatmap. */}
          <div className="seg-cross-wrap">
            <SegmentBrandCrossPanel data={snap.cross} />
          </div>

          {/* İskonto kırılımı: Ek Grup / nokta (müşteri) bazında (md35). */}
          <div className="seg-cross-wrap">
            <IskontoBreakdownPanel ekGrup={snap.ekGrupIskonto} musteri={snap.musteriIskonto} />
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
          margin-bottom: 16px;
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
