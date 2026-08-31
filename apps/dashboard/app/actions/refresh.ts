"use server";

import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";

const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";

/**
 * Tek merkezi "Verileri yenile" server action — navbar butonundan çağrılır.
 *
 * İki ayrı cache katmanı tazelenir:
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ Katman A: Hono API tarafı (SQLite withCache)                  │
 *   │  - Map data:    /api/map/sync (POST) → TBLMUSTERI mirror      │
 *   │  - Komuta snap: /api/komuta?refresh=1 → withCache(force)       │
 *   │                                                                │
 *   │ Katman B: Next.js Data Cache tarafı (RAM)                     │
 *   │  - revalidateTag("map") → bir sonraki fetch Hono'ya gider     │
 *   │  - revalidateTag("komuta") → aynı                              │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * İkisini birden invalidate etmeli; aksi halde:
 *   - Sadece A: RAM hala eski snapshot'ı verir → kullanıcı taze data göremez
 *   - Sadece B: Hono SQLite hala eski snapshot'ı verir → tazeleme illüzyon
 *
 * Bu sayede:
 *   - Hiç refresh basılmadıkça → cache 5 dk RAM'de (sayfa geçişi <1s)
 *   - Refresh basıldığında → MSSQL'e tek seferde gidilir (saha DB'yi yormaz)
 *   - Gece cron aynı action'ı çağırarak ısınma sağlar
 */
export async function refreshAllData(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    // TEK sunucu-taraflı tam yenileme: /api/refresh-all → now-anchor'ı yeniden
    // çözer + komuta (tl/9le) + TÜM V3 snapshot'ları + harita aynasını AYNI taze
    // anchor'la ısıtır. Eskiden yalnız komuta tazeleniyordu → cockpit taze,
    // yönetim/marka/... bayat kalıp farklı ciro gösteriyordu. Auth cookie'si
    // Bearer olarak iletilir (session guard + merkez ısıtma).
    const token = (await cookies()).get("enroute_auth")?.value;
    await fetch(`${API_URL}/api/refresh-all`, {
      method: "POST",
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    // 3. Next.js Data Cache invalidate — bir sonraki page render'da fetch'ler
    //    Hono'ya gidip yeni SQLite snapshot'ını alacak. Coarse-grained tag'lar
    //    `lib/api.ts:inferCacheTag()` ile eşleşir.
    //
    //    Next.js 16'da `revalidateTag` ikinci argüman olarak profile alır:
    //    - "max" → stale-while-revalidate (deprecated single-arg form bu davranıştı)
    //    - { expire: 0 } → anında geçersiz, bir sonraki fetch blocking
    //
    //    Refresh butonu kasıtlı olarak "şimdi tazele" anlamına geliyor; bu yüzden
    //    expire: 0 ile blocking invalidate. Kullanıcı sayfayı 1-2 sn beklemeyi
    //    bilerek tercih etti (eskinin 60-90s'ine kıyasla hâlâ büyük kazanç).
    revalidateTag("map", { expire: 0 });
    revalidateTag("komuta", { expire: 0 });
    revalidateTag("wietnauer", { expire: 0 }); // tüm V3 ekranları (yönetim/marka/...)
    revalidateTag("reports", { expire: 0 });
    revalidateTag("radar", { expire: 0 });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
