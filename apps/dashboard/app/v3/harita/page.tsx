import { MapPageBody } from "@/components/map-page-body";

export const metadata = { title: "Harita · V3 · Enroute Pusula" };

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
