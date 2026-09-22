import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER } from "@/lib/request-pathname";

const AUTH_COOKIE = "enroute_auth";

/**
 * Oturum yoksa /login'e yönlendir. Kimlik doğrulama otoritesi Hono API'dir;
 * burada yalnızca cookie varlığına bakarız (hızlı kapı). Geçersiz/expired
 * token'lar veri isteğinde API tarafından 401 ile reddedilir.
 *
 * Muaf yollar: /login, /setup (Faz A Dalga 2 — boş sunucuda henüz oturum
 * YOK, tavuk-yumurta; bkz. `app/layout.tsx` üst yorumu), /api/auth/*,
 * /api/setup/* (aynı gerekçe — kendi yetkisini `x-setup-token` header'ıyla
 * ayrıca kanıtlar, bkz. `app/api/setup/[...path]/route.ts`), Next statikleri.
 *
 * Ayrıca HER istekte `PATHNAME_HEADER` enjekte eder — kök layout (Server
 * Component) `isTenantFullyMissing()` true iken hangi sayfanın istendiğini
 * bilip `/setup` dışındakileri oraya yönlendirebilsin diye (bkz.
 * `lib/request-pathname.ts` üst yorumu). Bu ekleme mevcut auth/redirect
 * mantığını DEĞİŞTİRMEZ — yalnız `NextResponse.next()` çağrısına bir istek
 * header'ı ekler.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/setup/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt";

  const hasSession = req.cookies.get(AUTH_COOKIE)?.value;

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Zaten girişliyse /login'i kök'e çevir; kök tenant defaultLanding'ine
  // (varsa) yönlendirir (app/page.tsx). Böylece tenant'a göre doğru iner.
  if (hasSession && pathname === "/login") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(PATHNAME_HEADER, pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Tüm sayfalar + auth dışı API. Statikler matcher dışında.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
