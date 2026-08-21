import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE = "enroute_auth";

/**
 * Oturum yoksa /login'e yönlendir. Kimlik doğrulama otoritesi Hono API'dir;
 * burada yalnızca cookie varlığına bakarız (hızlı kapı). Geçersiz/expired
 * token'lar veri isteğinde API tarafından 401 ile reddedilir.
 *
 * Muaf yollar: /login, /api/auth/*, Next statikleri.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
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

  return NextResponse.next();
}

export const config = {
  // Tüm sayfalar + auth dışı API. Statikler matcher dışında.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
