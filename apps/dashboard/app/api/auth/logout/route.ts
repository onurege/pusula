// POST /api/auth/logout — :3000 auth cookie'sini sil (stateless JWT).
// Cookie silinmeden önce Hono API'ye best-effort logout bildirir (Bearer ile)
// ki kullanım analitiği `logout` olayını yazabilsin. API ulaşılamazsa veya
// hata dönerse logout yine de başarıyla tamamlanır — cookie her hâlükârda silinir.
const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";
const AUTH_COOKIE = "enroute_auth";

function readAuthToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === AUTH_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function POST(request: Request) {
  // Best-effort: analitik `logout` olayı için API'ye bildir. Logout'u ASLA
  // bloklamaz/başarısız etmez (session-end sinyali nice-to-have).
  const token = readAuthToken(request.headers.get("cookie"));
  if (token) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        // API takılırsa logout'u süresiz bekletme — best-effort, 1.5s sonra bırak.
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      // yut — API ulaşılamazsa logout yine de tamamlanır
    }
  }

  const forceInsecure = process.env.COOKIE_INSECURE === "1";
  const secure = process.env.NODE_ENV === "production" && !forceInsecure ? "; Secure" : "";

  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
  );
  return response;
}
