// GET /api/auth/distributors — kullanıcının izinli distribütörleri (dropdown).
import { cookies } from "next/headers";

const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";
const AUTH_COOKIE = "enroute_auth";

export async function GET() {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return Response.json({ error: "Oturum yok" }, { status: 401 });

  const res = await fetch(`${API_URL}/api/auth/distributors`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return Response.json({ error: "Alınamadı" }, { status: res.status });
  return Response.json(await res.json());
}
