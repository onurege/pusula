"use server";

import { revalidateTag } from "next/cache";
import { triggerMapSync } from "@/lib/api";

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
    // 1. SQLite mirror sync — TBLMUSTERI'yi MSSQL'den çek (~30s, ağır).
    //    Hono tarafında 5 dk throttle var; rapid tıklamada NOOP döner.
    await triggerMapSync();

    // 2. Komuta snapshot — refresh=1 ile Hono'ya zorla yeniden hesaplat.
    //    Bu Gemini brief'i de yeniden üretir; sonuç SQLite withCache'e yazılır.
    //    fetch burada no-store: Next.js Data Cache'e girmesin (zaten next adımda
    //    invalidate edilecek; ayrıca refresh=1 path'i lib/api.ts'te de no-store).
    await fetch(`${API_URL}/api/komuta?refresh=1`, { cache: "no-store" }).catch(
      () => {
        /* network sorunu olsa bile mirror sync zaten yapılmış olur */
      },
    );

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
    revalidateTag("reports", { expire: 0 });
    revalidateTag("radar", { expire: 0 });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
