// POST /api/auth/login — dashboard cookie köprüsü.
// Kimlik doğrulama Hono API'de (otorite); burada yalnızca token'ı :3000
// HttpOnly cookie'sine yazıyoruz. Böylece sonraki server-component fetch'leri
// cookie'yi okuyup Hono'ya Bearer olarak iletebiliyor.
const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";
const AUTH_COOKIE = "enroute_auth";

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Geçersiz istek" }, { status: 400 });
  }

  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: body.username, password: body.password }),
    cache: "no-store",
  });

  const data = (await res.json()) as {
    token?: string;
    user?: unknown;
    error?: string;
  };

  if (!res.ok || !data.token) {
    return Response.json({ error: data.error ?? "Giriş başarısız" }, { status: res.status || 401 });
  }

  // HTTPS yoksa (HTTP-only IIS proxy, ör. :9090) Secure cookie tarayıcıda
  // saklanmaz → login döngüye girer. COOKIE_INSECURE=1 ile Secure'ı kapat.
  const forceInsecure = process.env.COOKIE_INSECURE === "1";
  const secure = process.env.NODE_ENV === "production" && !forceInsecure ? "; Secure" : "";

  const response = Response.json({ user: data.user });
  response.headers.set(
    "Set-Cookie",
    `${AUTH_COOKIE}=${encodeURIComponent(data.token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${60 * 60 * 24}`,
  );
  return response;
}
