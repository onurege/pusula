import { MapPageBody } from "@/components/map-page-body";

// `force-dynamic` kaldırıldı — searchParams Promise zaten dynamic tetikliyor.
export const metadata = { title: "Harita · V2 · Enroute Pusula" };

/**
 * V2 Satış Haritası — `/map` (V1) ile aynı içeriği gösterir; tek fark
 * geri-dön linki `/v2` ve filter/breadcrumb drill-down hedefi `/v2/harita`.
 *
 * Eski versiyonda burası bir "launcher" sayfasıydı (3 ViewCard + /map'e
 * link); ama kart tıklayan kullanıcı V1'e düşüyordu (navbar V2'den V1'e
 * geçiyordu). IA tutarlılığı için artık doğrudan haritayı render ediyoruz —
 * preset filtreler için header'daki ViewModeToggle + sol panel filtreleri
 * zaten mevcut.
 */
export default async function V2HaritaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <MapPageBody
      searchParams={sp}
      basePath="/v2/harita"
      backHref="/v2"
      backLabel="← Radar"
    />
  );
}
