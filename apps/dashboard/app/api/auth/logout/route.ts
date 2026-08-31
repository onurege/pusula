// POST /api/auth/logout — :3000 auth cookie'sini sil (stateless JWT).
const AUTH_COOKIE = "enroute_auth";

export async function POST() {
  const forceInsecure = process.env.COOKIE_INSECURE === "1";
  const secure = process.env.NODE_ENV === "production" && !forceInsecure ? "; Secure" : "";

  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
  );
  return response;
}
