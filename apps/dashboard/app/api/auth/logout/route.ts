// POST /api/auth/logout — :3000 auth cookie'sini sil (stateless JWT).
const AUTH_COOKIE = "enroute_auth";

export async function POST() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  const response = Response.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
  );
  return response;
}
