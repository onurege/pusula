import { getWietnauerSegment, type WietnauerSegmentSnapshot } from "@/lib/api";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { GlobalDonemFilter } from "@/components/v3/GlobalDonemFilter";
import { donemLabel } from "@/lib/donem";
import { getLocale, t } from "@/lib/i18n";
import { MusteriGrupPanel } from "@/components/v3/segment/MusteriGrupPanel";
import { EkSahaPanel } from "@/components/v3/segment/EkSahaPanel";
import { EkGrupPanel } from "@/components/v3/segment/EkGrupPanel";
import { GrupKirilimPanel } from "@/components/v3/segment/GrupKirilimPanel";
import { SegmentBrandCrossPanel } from "@/components/v3/segment/SegmentBrandCrossPanel";
import { IskontoBreakdownPanel } from "@/components/v3/segment/IskontoBreakdownPanel";

export async function generateMetadata() {
  const locale = await getLocale();
  return { title: `${t(locale, "page.segment.title", "Müşteri Segmentasyon")} · V3 · Insider` };
}

/**
 * V3 Dashboard #3 — Müşteri Segmentasyon.
 *
 * md10 — dört bağımsız müşteri-kırılım boyutu yan yana (Yönetim Kurulu'nun
 * 4 segment paneliyle AYNI sırada), + altta cross-segment heatmap + iskonto
 * kırılımı (md35). Tip `WietnauerSegmentSnapshot` (`@/lib/api`, core'dan
 * re-export) kullanılır — sayfa artık kendi ad-hoc tipini tutmuyor.
 *
 *   A) Müşteri Grubu — TBLMUSTERIGRUP (OFF/ON TRADE/Turizm…, cockpit Kanal
 *      Mix ile AYNI boyut kaynağı). `musteriGrubu` alanı.
 *   B) Müşteri Ek Saha — birleşik ek saha (Saha1+2, iki-hop kaynak).
 *      `ekSaha` alanı.
 *   C) Müşteri Ek Grubu (bayilik formatı). `ekGrup` alanı.
 *   D) Müşteri Grup Kırılımı — TBLMUSTERIGRUPKIRILIM (Prestige/Premium/
 *      Standart…). `grupKirilim` alanı — md10 ile eklenen YENİ boyut.
 *   E) Cross: Müşteri Grubu × Marka heatmap.
 *   F) İskonto Kırılımı: Ek Grup / nokta (müşteri) bazında (md35).
 *
 * md10 ÖNCESİ `musteriGrubu` ve `ekSaha` alanlarının kaynağı TERSTİ (bkz.
 * `wietnauer-segment.ts` v8 notu) — bu sayfa ve alttaki panel bileşenleri
 * (`MusteriGrupPanel`/`EkSahaPanel`) o değişiklikle hizalandı.
 *
 * Cirosal segment (Wietnauer'da genelde boş) md32'den beri sayfada
 * gösterilmiyor; snapshot'ta hâlâ mevcut ama burada tüketilmiyor.
 *
 * Layout: geniş ekranda 4 sütun, orta ekranda 2×2, dar ekranda tek sütun.
 * Cross panel ve iskonto kırılım paneli her zaman tam genişlikte altta.
 */
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  searchParams: Promise<{ donem?: string; from?: string; to?: string }>;
};

export default async function V3MusteriSegmentasyonPage({ searchParams }: Props) {
  const locale = await getLocale();
  const sp = await searchParams;
  const dateFrom = sp.from && ISO_DATE_RX.test(sp.from) ? sp.from : null;
  const dateTo = sp.to && ISO_DATE_RX.test(sp.to) ? sp.to : null;
  const donem = dateFrom && dateTo ? null : (sp.donem ?? "").toLowerCase() || null;
  let snap: WietnauerSegmentSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerSegment<WietnauerSegmentSnapshot>({ dateFrom, dateTo, donem });
  } catch (e) {
    err = (e as Error).message;
  }

  // madde 7: statik açıklama yerine snapshot'tan gelen gerçek sayılar
  // (kırılım sayısı, toplam müşteri, ek grup sayısı) — uydurma değer yok.
  // md10: 4 boyutun ikisinin kaynağı yer değiştirdiği için sayaçlar/metin de
  // güncel alan-anlamına göre yeniden yazıldı (bkz. dosya üstü doc yorumu).
  const donemTxt = donemLabel(donem, dateFrom, dateTo, locale);
  const musteriGrubuSayisi = snap?.musteriGrubu.length ?? 0;
  const ekSahaSayisi = snap?.ekSaha.length ?? 0;
  const ekGrupSayisi = snap?.ekGrup.length ?? 0;
  const grupKirilimSayisi = snap?.grupKirilim.length ?? 0;
  const toplamMusteriSayisi = snap
    ? snap.musteriGrubu.reduce((acc, r) => acc + r.musteriSayi, 0)
    : 0;
  const description =
    locale === "en"
      ? snap
        ? `Four independent customer-breakdown dimensions over ${donemTxt} revenue, ${toplamMusteriSayisi.toLocaleString("tr-TR")} customers: Customer Group (customer group, ${musteriGrubuSayisi} groups), Customer Field (combined extended field, ${ekSahaSayisi} fields), Customer Sub-Group (dealer format, ${ekGrupSayisi} groups), and Customer Group Breakdown (Prestige/Premium/Standard…, ${grupKirilimSayisi} breakdowns). Below: Group × Brand heatmap and Sub-Group / outlet discount breakdown.`
        : `Four independent customer-breakdown dimensions side by side over ${donemTxt} revenue — customer group, extended field, sub-group (dealer format), and group breakdown. Below: Group × Brand heatmap and Sub-Group / outlet discount breakdown.`
      : snap
        ? `${donemTxt} ciro üzerinden ${toplamMusteriSayisi.toLocaleString("tr-TR")} müşteri, dört bağımsız müşteri-kırılım boyutu: Müşteri Grubu (müşteri grubu, ${musteriGrubuSayisi} grup), Müşteri Ek Saha (birleşik ek saha, ${ekSahaSayisi} saha), Müşteri Ek Grubu (bayilik formatı, ${ekGrupSayisi} grup) ve Müşteri Grup Kırılımı (Prestige/Premium/Standart…, ${grupKirilimSayisi} kırılım). Altta Grup × Marka heatmap'i ve Ek Grup / nokta bazında iskonto kırılımı.`
        : `Dört bağımsız müşteri-kırılım boyutu ${donemTxt} ciro üzerinden yan yana — müşteri grubu, ek saha, ek grup (bayilik formatı) ve grup kırılımı. Altta Grup × Marka heatmap'i ve Ek Grup / nokta bazında iskonto kırılımı.`;

  return (
    <div className="v3-page">
      <V3PageHeader
        locale={locale}
        eyebrow={t(locale, "page.segment.eyebrow", "Dashboard 03")}
        title={t(locale, "page.segment.title", "Müşteri Segmentasyon")}
        contentKey="page.segment.title"
        descKey="page.segment.desc"
        description={description}
        dataNote="TBLMUSTERIGRUP · TBLMUSTERIEKSAHA/TBLEKSAHASECENEK · TBLMUSTERIEKGRUP · TBLMUSTERIGRUPKIRILIM · TBLURUNGRUP · TBLMSDFATURA.DBLISKONTOTUTARI"
        generatedAt={snap?.generatedAt}
      />

      <GlobalDonemFilter />

      {err && (
        <div className="v3-error">
          <strong>{t(locale, "page.segment.error", "Veri alınamadı:")}</strong> {err}
          <div className="v3-error-hint">
            {t(locale, "page.segment.error_hint", "VPN kontrol et veya MSSQL bağlantı durumunu doğrula.")}
          </div>
        </div>
      )}

      {snap && (
        <>
          {/* Üst sıra: 4 bağımsız segment boyutu yan yana, md10 sırasıyla —
              Yönetim Kurulu'nun 4 iskonto segment paneliyle AYNI sıra. */}
          <div className="seg-quad-grid">
            <MusteriGrupPanel rows={snap.musteriGrubu} locale={locale} />
            <EkSahaPanel rows={snap.ekSaha} locale={locale} />
            <EkGrupPanel rows={snap.ekGrup} locale={locale} />
            <GrupKirilimPanel rows={snap.grupKirilim} locale={locale} />
          </div>

          {/* Alt sıra: tam genişlik cross-segment heatmap. */}
          <div className="seg-cross-wrap">
            <SegmentBrandCrossPanel data={snap.cross} locale={locale} />
          </div>

          {/* İskonto kırılımı: Ek Grup / nokta (müşteri) bazında (md35). */}
          <div className="seg-cross-wrap">
            <IskontoBreakdownPanel ekGrup={snap.ekGrupIskonto} musteri={snap.musteriIskonto} locale={locale} />
          </div>
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .seg-quad-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }
        @media (min-width: 900px) {
          .seg-quad-grid {
            grid-template-columns: repeat(2, 1fr);
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
