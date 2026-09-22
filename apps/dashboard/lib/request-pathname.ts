/**
 * `middleware.ts` → kök layout (Server Component) pathname köprüsü.
 *
 * Next.js Server Component'ler istek pathname'ini doğrudan göremez (yalnız
 * middleware `NextRequest.nextUrl` üzerinden görür). Kök layout'un boş-
 * sunucu/setup-modu kararı (`app/layout.tsx` — `isTenantFullyMissing()` true
 * iken hangi sayfanın istendiğini bilmeden `/setup`'a yönlendiremez) bu
 * bilgiye ihtiyaç duyar; resmi köprü yolu middleware'in bir header enjekte
 * edip `next/headers` `headers()` ile aşağı taşımasıdır (bkz. Next.js
 * self-hosting rehberi, "Proxy" bölümü — fs gerektiren mantığı Proxy/Edge
 * yerine layout'a taşımayı önerir).
 *
 * Gizli/hassas DEĞİL (yalnız yol bilgisi) — güvenlik sınırı değil, yalnız
 * routing kolaylığı.
 */
export const PATHNAME_HEADER = "x-pathname";
