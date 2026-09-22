import { MapPageBody } from "@/components/map-page-body";
import { getLocale, t } from "@/lib/i18n";

export async function generateMetadata() {
  const locale = await getLocale();
  return { title: `${t(locale, "nav.harita", "Harita")} · V3 · Insider` };
}

/**
 * V3 Satış Haritası — V1 /map ve V2 /v2/harita ile aynı içerik, sadece
 * navbar bağlamı ve geri-dön linki v3 IA'ya hizalanmış. Cockpit haritasındaki
 * il polygon click'i ve FinanceAgentModal "haritada müşterileri gör"
 * linkleri buraya yönlenir (usePathname tabanlı dinamik basePath).
 */
export default async function V3HaritaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MapPageBody
      searchParams={sp}
      basePath="/v3/harita"
      backHref="/v3/cockpit"
      backLabel="← Cockpit"
    />
  );
}
