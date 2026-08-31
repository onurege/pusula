// /api/admin/* → Hono API proxy. Admin ekranları (Yetkiler) client-side
// fetch ile bu yollara vurur; burada cookie'deki token Bearer'a çevrilip
// backend'e iletilir. Yetki kontrolü (merkez rolü) backend'de yapılır.
import { cookies } from "next/headers";

const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";
const AUTH_COOKIE = "enroute_auth";

async function forward(
  req: Request,
  path: string[],
  method: "GET" | "POST",
): Promise<Response> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return Response.json({ error: "Oturum yok" }, { status: 401 });

  const sub = path.map(encodeURIComponent).join("/");
  const qs = new URL(req.url).search;
  const url = `${API_URL}/api/admin/${sub}${qs}`;

  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  };
  if (method === "POST") init.body = await req.text();

  const res = await fetch(url, init);
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path, "GET");
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, path, "POST");
}
