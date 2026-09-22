// GET /api/auth/databases — çok-DB login dropdown'ı için seçilebilir
// veritabanları (yalnız id+label). Public: login ÖNCESİ okunur, token
// gerektirmez. Hono API'ye köprüler; tek-DB tenant'ta veya API erişilemezse
// boş dizi döner (dashboard dropdown'ı gizler).
const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/auth/databases`, { cache: "no-store" });
    if (!res.ok) return Response.json({ databases: [] });
    return Response.json(await res.json());
  } catch {
    return Response.json({ databases: [] });
  }
}
