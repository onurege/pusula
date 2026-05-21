/**
 * Pernod TBLDISTGRUP isimlerini listele ve klasik 7 bölge eşleştirmesini
 * dene — Doğu Anadolu'nun haritada eksik kalma sebebini bulmak için.
 */
import { runReadOnly } from "../packages/core/src/index.js";

// TurkeyMapPolygon ile birebir aynı mapping (kopyalanmış)
const REGION_ALIASES: Record<string, string[]> = {
  "Güneydoğu Anadolu": [
    "GUNEYDOGU", "GUNEY DOGU", "GUNEY-DOGU", "G.DOGU", "G DOGU",
    "GD ANADOLU", "GD-ANADOLU", "GD.ANADOLU",
    "GAZIANTEP", "ANTEP", "DIYARBAKIR", "SANLIURFA", "URFA", "MARDIN",
    "BATMAN", "SIIRT", "KILIS", "ADIYAMAN",
  ],
  "Doğu Anadolu": [
    "DOGU ANADOLU", "DOGU-ANADOLU", "DOGUANADOLU", "D.ANADOLU", "D ANADOLU",
    "VAN", "ERZURUM", "MALATYA", "ELAZIG", "BINGOL", "AGRI", "KARS",
    "ERZINCAN", "MUS", "BITLIS", "IGDIR", "ARDAHAN", "TUNCELI",
  ],
  "İç Anadolu": [
    "IC ANADOLU", "IC-ANADOLU", "ICANADOLU", "I.ANADOLU", "I ANADOLU",
    "ICAN", "ANADOLU",
    "ANKARA", "ASYA",
    "KONYA", "KAYSERI", "ESKISEHIR", "SIVAS", "AKSARAY", "YOZGAT",
    "NEVSEHIR", "NIGDE", "KIRSEHIR", "KIRIKKALE", "KARAMAN", "CANKIRI",
  ],
  Marmara: [
    "MARMARA", "IST", "ISTANBUL", "AVRUPA", "TRAKYA",
    "BURSA", "TEKIRDAG", "EDIRNE", "KIRKLARELI", "CANAKKALE",
    "BALIKESIR", "YALOVA", "KOCAELI", "SAKARYA", "BILECIK",
  ],
  Ege: [
    "EGE", "IZMIR", "AYDIN", "MUGLA", "DENIZLI", "MANISA",
    "KUTAHYA", "USAK", "AFYON",
  ],
  Akdeniz: [
    "AKDENIZ", "ANTALYA", "MERSIN", "ICEL", "ADANA", "HATAY",
    "OSMANIYE", "KAHRAMANMARAS", "MARAS", "BURDUR", "ISPARTA",
  ],
  Karadeniz: [
    "KARADENIZ", "SAMSUN", "TRABZON", "RIZE", "ARTVIN", "GIRESUN",
    "ORDU", "TOKAT", "AMASYA", "CORUM", "SINOP", "KASTAMONU",
    "BARTIN", "BOLU", "DUZCE", "ZONGULDAK", "KARABUK", "GUMUSHANE",
    "BAYBURT",
  ],
  Kıbrıs: ["KKTC", "KIBRIS", "LEFKOSA", "GIRNE", "MAGUSA"],
};

function toClassicalRegion(pernodName: string): string | null {
  const norm = pernodName.toLocaleUpperCase("tr").replace(/[ÇĞİıŞÜÖ]/g, (c) =>
    ({ Ç: "C", Ğ: "G", İ: "I", ı: "I", Ş: "S", Ü: "U", Ö: "O" })[c] ?? c,
  );
  for (const [classical, aliases] of Object.entries(REGION_ALIASES)) {
    if (aliases.some((a) => norm.includes(a))) return classical;
  }
  return null;
}

async function main() {
  // Tüm aktif TBLDISTGRUP isimleri + son 30g ciroları
  const sql = `
    SELECT
      dg.TXTAD AS bolge,
      dg.TXTKOD AS bolgeKod,
      ISNULL(SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
                       AND f.BYTTUR = 0 AND f.BYTDURUM = 0
                      THEN f.DBLNETTUTAR ELSE 0 END), 0) AS ciro30,
      COUNT(DISTINCT CASE WHEN d.BYTDURUM = 0 THEN d.LNGKOD END) AS distAktif
    FROM dbo.TBLDISTGRUP dg
    LEFT JOIN dbo.TBLDIST d ON d.TXTGRUP = dg.TXTKOD
    LEFT JOIN dbo.TBLMSDFATURA f ON f.LNGDISTKOD = d.LNGKOD
    GROUP BY dg.TXTAD, dg.TXTKOD
    ORDER BY ciro30 DESC
  `;
  const out = await runReadOnly(sql, { limit: 100, timeoutMs: 60_000 });

  console.log(`\nToplam ${out.rows.length} TBLDISTGRUP:\n`);
  console.log("Bölge adı".padEnd(35), "Kod".padEnd(8), "Dist".padEnd(6), "Ciro30".padEnd(15), "→ Klasik");
  console.log("─".repeat(110));

  const byClassical = new Map<string, string[]>();
  const unmatched: string[] = [];

  for (const r of out.rows) {
    const bolge = String(r.bolge ?? "—");
    const kod = String(r.bolgeKod ?? "—");
    const dist = Number(r.distAktif ?? 0);
    const ciro = Number(r.ciro30 ?? 0);
    const cls = toClassicalRegion(bolge);
    const ciroFmt = ciro > 0 ? ciro.toLocaleString("tr-TR") : "—";
    console.log(
      bolge.padEnd(35),
      kod.padEnd(8),
      String(dist).padEnd(6),
      ciroFmt.padEnd(15),
      cls ?? "❌ UNMATCHED",
    );
    if (cls) {
      if (!byClassical.has(cls)) byClassical.set(cls, []);
      byClassical.get(cls)!.push(bolge);
    } else {
      unmatched.push(bolge);
    }
  }

  console.log("\n=== Klasik bölge → eşleşen Pernod isimler ===\n");
  const allClassical = [
    "Marmara", "Ege", "Akdeniz", "İç Anadolu",
    "Karadeniz", "Doğu Anadolu", "Güneydoğu Anadolu", "Kıbrıs",
  ];
  for (const cls of allClassical) {
    const pernod = byClassical.get(cls) ?? [];
    const status = pernod.length === 0 ? "❌ EKSİK" : `✓ ${pernod.length} bölge`;
    console.log(`${cls.padEnd(25)} ${status}`);
    for (const p of pernod) console.log(`    ${p}`);
  }

  if (unmatched.length > 0) {
    console.log("\n=== Eşleşmeyen Pernod isimleri ===");
    for (const u of unmatched) console.log(`  ${u}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
