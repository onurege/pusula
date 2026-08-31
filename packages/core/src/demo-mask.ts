/**
 * Demo maskeleme — `demoData: true` tenant'larda (fmcg-demo) API yanıtlarındaki
 * GERÇEK isimleri (distribütör/marka/müşteri/temsilci) sentetik demo isimlerine
 * çevirir. SAYILAR dokunulmaz — grafikler/oranlar gerçekçi kalır; sadece kimlik
 * taşıyan metinler maskelenir.
 *
 * Neden gerek: demo tenant'ın MSSQL prefix'i yok → PERNOD_TEST'e düşüyor; V3
 * ekranları gerçek Pernod isimlerini gösteriyordu. sqlite'ta transactional veri
 * yok + fetcher'lar T-SQL olduğu için sqlite'a yönlendirilemiyor; en pratik
 * çözüm sunum-katmanı maskeleme.
 *
 * Deterministik: aynı gerçek isim HER ZAMAN aynı demo ismine map'lenir (hash →
 * havuz indeksi), böylece ekranlar arası tutarlı. İsim havuzu haritanın sentetik
 * verisiyle (`fmcg-demo.sqlite` map_distributors) aynı üslupta.
 *
 * Cache güvenliği: çağıran taraf snapshot'ı KLONLAYIP verir — bu modül gelen
 * nesneyi yerinde değiştirir, o yüzden cache'lenmiş orijinali mutasyona uğratma.
 */
import { getTenantConfig } from "./tenant/index.js";

export function isDemoMasking(): boolean {
  return getTenantConfig().demoData === true;
}

// FNV-1a — küçük, deterministik, bağımlılıksız.
function hashStr(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0);
}

// Korunacak (maskelenmeyecek) özel etiketler — fold-other/toplam vb.
const PRESERVE = new Set([
  "Diğer", "Toplam", "TOPLAM", "Genel Toplam", "Bilinmiyor", "Tanımsız",
  "—", "-", "", "Rut İçi", "Rut Dışı",
]);

// Distribütör = {baz} {sonek} — baz index'le (benzersiz), sonek hash'le (çeşit).
// Bazlar haritanın (map_distributors) üslubuyla aynı.
const DIST_BASE = [
  "AKSAN", "TAÇ", "MAVİ", "EGE", "ANADOLU", "PINAR", "GÜNDOĞAN", "BEREKET",
  "ALTIN", "MARMARA", "YILDIZ", "DOĞU", "BATI", "GÜNEŞ", "ÇINAR", "GÜVEN",
  "USTA", "DENİZ", "ASLAN", "EMRE", "BÜYÜK", "FATİH", "OSMAN", "CESUR",
  "ANATOLİA", "TURKDAY", "PİRAMİT", "ZAFER", "KAYA", "ATLAS", "MERİDYEN", "TOROS",
  "EFES", "KENT", "NAR", "SELİN", "BORA", "UMUT", "KARTAL", "VADİ",
];
const DIST_SUFFIX = ["GIDA", "DAĞITIM", "TİCARET", "GIDA DAĞITIM", "LOJİSTİK", "FOODS"];

// Marka = {baz} {tier} — kurgusal FMCG içecek markaları (gerçek marka değil).
const BRAND_BASE = [
  "Altınbaşak", "Kraliyet", "Efe", "Zümrüt", "Meridyen", "Boğaz", "Anadolu", "Nova",
  "Pera", "Vega", "Kartal", "Lidya", "Truva", "Marmara", "Safir", "Yıldız",
  "Kervan", "Zafer", "Panorama", "Kule", "Nar", "Deniz", "Toros", "Bereket",
  "Işık", "Vadi", "Cesur", "Bora", "Ferah", "Umut", "Kent", "Selin",
  "Atlas", "Efes", "Ege", "Altın Nokta", "Sultan", "Bosphor", "Levent", "Nazar",
];
const BRAND_TIER = ["", "Reserve", "Gold", "Klasik", "Premium", "Select", "Blend", "Extra"];

// Müşteri unvanı üreteci — {ön} {tip} (harita unvanlarıyla benzer üslup).
const CUST_A = [
  "ANADOLU", "USTA", "ZAFER", "BEREKET", "DOĞU", "BATI", "MERKEZ", "YILDIZ",
  "GÜNEŞ", "MAVİ", "ALTIN", "GÜVEN", "DENİZ", "ASLAN", "EMRE", "BÜYÜK",
  "FATİH", "OSMAN", "CESUR", "NAR", "SELİN", "BORA", "UMUT", "KENT",
  "PERA", "TOROS", "EFES", "LİDYA", "TRUVA", "KARTAL", "SAFİR", "KERVAN",
  "VADİ", "IŞIK", "FERAH", "NOVA", "VEGA", "KULE", "ATLAS", "MERİDYEN",
];
const CUST_TYPE = [
  "MARKET", "ŞARKÜTERİ", "BAKKAL", "BÜFE", "GIDA", "TİCARET",
  "MARKET & PETROL", "SHOP", "GROSS MARKET", "MİNİ MARKET",
];

// Temsilci adı üreteci — {ad} {soyad}.
const REP_FIRST = [
  "Ahmet", "Mehmet", "Mustafa", "Ali", "Hüseyin", "Hasan", "İbrahim", "Osman",
  "Yusuf", "Murat", "Emre", "Burak", "Serkan", "Volkan", "Kaan", "Onur",
  "Cem", "Barış", "Tolga", "Gökhan", "Selim", "Deniz", "Ozan", "Uğur",
  "Ferhat", "Sinan", "Tarık", "Kerem", "Baran", "Arda", "Eren", "Umut",
  "Elif", "Zeynep", "Merve", "Ayşe", "Fatma", "Esra", "Büşra", "Derya",
];
const REP_LAST = [
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk",
  "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara",
  "Koç", "Kurt", "Özkan", "Şimşek", "Polat", "Korkmaz", "Çakır", "Erdoğan",
  "Güneş", "Aksoy", "Bulut", "Turan", "Bozkurt", "Aydemir", "Taş", "Yavuz",
  "Karadağ", "Uçar", "Duman", "Ateş", "Bayram", "Güler", "Tekin", "Sarı",
];

// Ürün/SKU = {marka baz} {tür} {boy} — kurgusal içecek SKU'ları.
const PROD_TYPE = ["Viski", "Rakı", "Vodka", "Cin", "Likör", "Şarap", "Kanyak", "Tekila"];
const PROD_SIZE = ["70cl", "100cl", "35cl", "75cl", "1L", "50cl"];

export type MaskCategory = "distributor" | "brand" | "customer" | "rep" | "product";

// Alan adı → kategori (sabit olanlar). "ad" bağlama göre çözülür (aşağıda).
const KEY_CATEGORY: Record<string, MaskCategory> = {
  unvan: "customer",
  kisaAd: "customer",
  distributor: "distributor",
  distAd: "distributor",
  distName: "distributor",
  marka: "brand",
  brand: "brand",
  // `grup` = ürün KATEGORİSİ (Çikolata & Şekerleme, Çay, Kahve — jenerik FMCG,
  // kimlik değil) → maskelenmez; brief'le tutarlı kalsın. Kimlikler (marka/
  // dist/müşteri/ürün/temsilci) maskeli.
  skuName: "product",
};

/** i. distinct gerçek isim için demo ismi. Birincil eksen = index i (benzersiz),
 *  ikincil eksen = hash(real) (çeşitlilik → "hepsi Yılmaz" kümelemesi olmaz). */
function demoNameForIndex(category: MaskCategory, i: number, real: string): string {
  switch (category) {
    case "distributor":
      return `${DIST_BASE[i % DIST_BASE.length]!} ${DIST_SUFFIX[hashStr(real, 3) % DIST_SUFFIX.length]!}`;
    case "brand": {
      const base = BRAND_BASE[i % BRAND_BASE.length]!;
      const tier = BRAND_TIER[hashStr(real, 5) % BRAND_TIER.length]!;
      return tier ? `${base} ${tier}` : base;
    }
    case "customer":
      // ikincil eksen coprime stride (gcd(3,10)=1) → küçük sette çakışmasız + çeşitli
      return `${CUST_A[i % CUST_A.length]!} ${CUST_TYPE[(i * 3) % CUST_TYPE.length]!}`;
    case "rep":
      // gcd(17,40)=1 → i<40 için (first,last) çifti tam permütasyon (çakışmasız)
      return `${REP_FIRST[i % REP_FIRST.length]!} ${REP_LAST[(i * 17) % REP_LAST.length]!}`;
    case "product":
      return `${BRAND_BASE[i % BRAND_BASE.length]!} ${PROD_TYPE[hashStr(real, 19) % PROD_TYPE.length]!} ${PROD_SIZE[hashStr(real, 23) % PROD_SIZE.length]!}`;
  }
}

type Ctx = Record<MaskCategory, Map<string, string>>;

/** Bir string'i (verilen kategoride) ctx map'i üzerinden maskeler. */
function apply(ctx: Ctx, category: MaskCategory, real: string): string {
  const t = real.trim();
  if (PRESERVE.has(t)) return real;
  return ctx[category].get(t) ?? real;
}

// Serbest metin (AI brief vb.) alanları — kategori değil; içindeki bilinen
// gerçek isimler ctx üzerinden demo isimleriyle değiştirilir.
const PROSE_KEYS = new Set([
  "brief", "text", "summary", "yorum", "narrative", "aiComment", "aiYorum",
  "headline", "message", "aciklama", "note", "insight",
]);

/** Prose içindeki tüm bilinen gerçek isimleri demo karşılıklarıyla değiştirir.
 *  Uzun isimler önce (kısmi örtüşmeyi önler); literal (regex değil) replace. */
function maskProse(text: string, ctx: Ctx): string {
  const pairs: Array<[string, string]> = [];
  for (const cat of Object.keys(ctx) as MaskCategory[]) {
    for (const [real, demo] of ctx[cat]) {
      if (real.length >= 3 && real !== demo) pairs.push([real, demo]);
    }
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [real, demo] of pairs) out = out.split(real).join(demo);
  return out;
}

/**
 * Snapshot'ı dolaşır: `collect=true` iken distinct gerçek isimleri kategori
 * bazlı toplar (sets); `collect=false` iken ctx map'i uygular. İki geçiş aynı
 * traversal + aynı `ad` disambiguation (nesnede distributor/distAd varsa rep).
 */
// `ad` alanı bu array'lerin altında JENERİK KATEGORİ etiketidir (müşteri tipi /
// bayilik formatı) — distribütör/ürün değil, maskelenmez.
const PROTECT_AD_PARENT = new Set(["ekSaha", "ekGrup"]);

function traverse(
  node: unknown,
  mode: { collect: Record<MaskCategory, Set<string>> } | { apply: Ctx },
  parentKey?: string,
): void {
  if (Array.isArray(node)) {
    for (const el of node) traverse(el, mode, parentKey);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  // "ad" bağlamı: ürün satırı mı (urunKod/skuCode/skuId), temsilci mi
  // (distributor/distAd), yoksa distribütör mü?
  const hasProductContext =
    "urunKod" in obj || "skuCode" in obj || "skuId" in obj || "urunKodu" in obj;
  const hasRepContext = "distributor" in obj || "distAd" in obj;
  const adCategory: MaskCategory = hasProductContext
    ? "product"
    : hasRepContext
      ? "rep"
      : "distributor";
  const adProtected = parentKey != null && PROTECT_AD_PARENT.has(parentKey);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string") {
      // Serbest metin alanları: apply geçişinde prose-replace, collect'te atla.
      if (PROSE_KEYS.has(key)) {
        if ("apply" in mode) obj[key] = maskProse(val, mode.apply);
        continue;
      }
      const cat: MaskCategory | undefined =
        key === "ad" ? (adProtected ? undefined : adCategory) : KEY_CATEGORY[key];
      if (!cat) continue;
      const t = val.trim();
      if (PRESERVE.has(t)) continue;
      if ("collect" in mode) mode.collect[cat].add(t);
      else obj[key] = apply(mode.apply, cat, val);
    } else if (val && typeof val === "object") {
      traverse(val, mode, key);
    }
  }
}

/**
 * demoData tenant'ta snapshot'ı klonlayıp isimleri maskeler; değilse aynen
 * döner (wietnauer/pernod prod'da SIFIR etki).
 *
 * İki geçiş: (1) distinct gerçek isimleri topla, (2) hash-sıralı deterministik
 * sırayla çakışmasız demo isimleri ata + uygula. Hash-sıralı olduğu için AYNI
 * isim seti → AYNI atama (ekranlar arası tutarlı); benzersiz index → aynı
 * ekranda tekrarsız.
 */
export function maskDemoSnapshot<T>(snap: T): T {
  if (!isDemoMasking()) return snap;
  const clone = structuredClone(snap);

  const sets: Record<MaskCategory, Set<string>> = {
    distributor: new Set(), brand: new Set(), customer: new Set(), rep: new Set(),
    product: new Set(),
  };
  traverse(clone, { collect: sets });

  const ctx: Ctx = {
    distributor: new Map(), brand: new Map(), customer: new Map(), rep: new Map(),
    product: new Map(),
  };
  for (const cat of Object.keys(sets) as MaskCategory[]) {
    // Hash-sıralı → set-kararlı, deterministik. Eşit hash'te string tiebreak.
    const sorted = [...sets[cat]].sort(
      (a, b) => hashStr(a) - hashStr(b) || (a < b ? -1 : a > b ? 1 : 0),
    );
    sorted.forEach((real, i) => ctx[cat].set(real, demoNameForIndex(cat, i, real)));
  }

  traverse(clone, { apply: ctx });
  return clone;
}
