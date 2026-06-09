import { MapPageBody } from "@/components/map-page-body";

// `force-dynamic` kaldırıldı — sayfa zaten `searchParams` Promise'i kullanıyor
// (Request-time API → otomatik dynamic). Eskiden force-dynamic her fetch'i
// `no-store`'a zorladığı için Data Cache devre dışı kalıyordu; şimdi
// `lib/api.ts:request()` tag'li revalidate ile 5 dk RAM cache kullanıyor.

/**
 * V1 Satış Haritası — sayfa içeriği `MapPageBody`'de paylaşılan server
 * component'te. Aynı içerik `/v2/harita`'da da render edilir; tek fark
 * `backHref` (geri-dön linki) ve `basePath` (filter/drill linkleri).
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MapPageBody
      searchParams={sp}
      basePath="/map"
      backHref="/"
      backLabel="← Radar"
    />
  );
}
