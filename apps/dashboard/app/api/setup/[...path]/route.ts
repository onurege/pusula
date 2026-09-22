// /api/setup/* → Hono API'nin GÜVENLİ SETUP MODU uçlarına (`apps/api/src/
// setup-gate.ts`) ince bir proxy — Faz A Dalga 2. `app/api/admin/[...path]/
// route.ts`'ten (admin proxy) FARKI: burada bir OTURUM/cookie YOK (henüz
// kullanıcı/DB yok — tavuk-yumurta, bkz. `packages/core/src/tenant/
// setup-mode.ts` üst yorumu); tek yetki kanıtı istemcinin gönderdiği
// `x-setup-token` header'ı. Bu header OLDUĞU GİBİ (değiştirilmeden) backend'e
// ileri taşınır — burada ASLA loglanmaz, ASLA cookie/dosyaya yazılmaz
// (yalnız istek ömrü boyunca geçer, bkz. `app/setup/page.tsx` üst yorumu).
//
// Setup uçları yalnız POST'tur (`db-connection/test`, `db-connection`,
// `tenant` — `apps/api/src/server.ts` setup bloğu) — GET yok, bu yüzden
// yalnız POST export edilir.
import { SETUP_TOKEN_HEADER } from "@/app/setup/types";

const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const token = req.headers.get(SETUP_TOKEN_HEADER);
  // Token yoksa backend'e hiç gitmeden 401 — backend zaten aynı kararı
  // verir (`createSetupGate`), burada erken kesmek gereksiz bir round-trip'i
  // önler; mesaj backend'in 401 mesajıyla tutarlı, sanitize.
  if (!token) {
    return Response.json({ error: "Kurulum token gerekli" }, { status: 401 });
  }

  const sub = path.map(encodeURIComponent).join("/");
  const url = `${API_URL}/api/setup/${sub}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SETUP_TOKEN_HEADER]: token,
    },
    body: await req.text(),
    cache: "no-store",
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}
