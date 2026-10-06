// POST /api/telemetry — beacon hedefi. Tek yazar API olsun diye gövde olduğu
// gibi Hono API'ye iletilir (`/api/admin/[...path]` ile AYNI desen: cookie'deki
// token Bearer'a çevrilir; yetki + doğrulama + clamp API'de yapılır).
// Telemetri fail-silent: client yanıtı beklemez, burada da asla 500 üretmeyiz.
import { cookies } from "next/headers";

const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";
const AUTH_COOKIE = "enroute_auth";
const MAX_BODY_CHARS = 64 * 1024; // sendBeacon limiti ile aynı; 50 olay bunun çok altında

export async function POST(req: Request) {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return Response.json({ error: "Oturum yok" }, { status: 401 });

  let body: string;
  try {
    body = await req.text();
  } catch {
    return Response.json({ error: "Geçersiz istek" }, { status: 400 });
  }
  if (body.length > MAX_BODY_CHARS) {
    return Response.json({ error: "İstek çok büyük" }, { status: 413 });
  }

  try {
    const res = await fetch(`${API_URL}/api/telemetry`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    // API ulaşılamaz — telemetri kaybı kabul edilebilir, dashboard etkilenmez.
    return Response.json({ ok: false }, { status: 502 });
  }
}
