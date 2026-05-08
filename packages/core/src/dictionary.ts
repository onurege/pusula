// Univera column-name prefix conventions → Turkish type hint
export const PREFIX_MAP: Record<string, string> = {
  LNG: "sayı",
  TXT: "metin",
  BYT: "bayrak",
  TRH: "tarih",
  DBL: "ondalık sayı",
  IMG: "görsel",
  BIN: "dosya",
  UID: "benzersiz kimlik",
};

// Turkish business-term keywords appearing in Univera table/column names.
// Seed taken from text-to-sql/lib/context.ts; extend as we discover new terms.
export const KEYWORD_MAP: Record<string, string> = {
  FATURA: "fatura",
  SIPARIS: "sipariş",
  IRSALIYE: "irsaliye",
  MUSTERI: "müşteri",
  URUN: "ürün",
  DIST: "dağıtıcı/satış temsilcisi",
  PERSONEL: "personel",
  DEPO: "depo",
  STOK: "stok",
  SATIS: "satış",
  ALIS: "alış",
  BELGE: "belge",
  HAREKET: "hareket",
  TAHSILAT: "tahsilat",
  ODEME: "ödeme",
  BANKA: "banka",
  HESAP: "hesap",
  ISKONTO: "iskonto",
  KDV: "KDV",
  TUTAR: "tutar",
  TOPLAM: "toplam",
  BRUT: "brüt",
  NET: "net",
  ADET: "adet",
  BIRIM: "birim",
  FIYAT: "fiyat",
  TARIH: "tarih",
  DURUM: "durum",
  ACIKLAMA: "açıklama",
  KOD: "kod",
  ISLEM: "işlem",
  KULLANICI: "kullanıcı",
  RAPOR: "rapor",
  HEDEF: "hedef",
  GOREV: "görev",
  MESAJ: "mesaj",
  ADRES: "adres",
  SEVK: "sevk",
  VADE: "vade",
  KRITER: "kriter",
  TANIM: "tanım",
  GRUP: "grup",
  PARAMETRE: "parametre",
  LOG: "log",
  ARSIV: "arşiv",
  EARSIV: "e-arşiv",
  EBELGE: "e-belge",
  EFATURA: "e-fatura",
  CARI: "cari",
  BUTCE: "bütçe",
  KAMPANYA: "kampanya",
  AKTIVITE: "aktivite",
  ZIYARET: "ziyaret",
  RUT: "rut/güzergah",
  MAGAZA: "mağaza",
  BAYI: "bayi",
  BARKOD: "barkod",
  PALET: "palet",
  ISEMRI: "iş emri",
  SEPET: "sepet",
  DOVIZ: "döviz",
  KOMISYON: "komisyon",
  ARAC: "araç",
  GIDER: "gider",
  GUMRUK: "gümrük",
  QUEST: "anket/görev",
  CRM: "CRM",
  MSD: "MSD/ana",
  SB: "SB/alt sistem",
  ESY: "entegrasyon",
  FOTO: "fotoğraf",
  ONAY: "onay",
  IPTAL: "iptal",
  IADE: "iade",
  TESLIMAT: "teslimat",
  TESLIM: "teslimat",
  GARANTI: "garanti",
  LIMIT: "limit",
  KOTA: "kota",
  ONCELIK: "öncelik",
  HATIR: "hatır",
  HATA: "hata",
};

export function extractKeywords(name: string): string[] {
  const upper = name.toUpperCase().replace(/^TBL/, "");
  const found: string[] = [];
  for (const [key, val] of Object.entries(KEYWORD_MAP)) {
    if (upper.includes(key)) found.push(val);
  }
  return [...new Set(found)];
}

export function describeColumn(colName: string): string {
  const upper = colName.toUpperCase();
  let prefix = "";
  for (const p of Object.keys(PREFIX_MAP)) {
    if (upper.startsWith(p)) {
      prefix = p;
      break;
    }
  }
  const body = prefix ? upper.slice(prefix.length) : upper;
  const typeHint = prefix ? PREFIX_MAP[prefix] : "";

  const parts: string[] = [];
  for (const [key, val] of Object.entries(KEYWORD_MAP)) {
    if (body.includes(key)) parts.push(val);
  }
  const meaning = parts.length > 0 ? parts.join(" ") : body.toLowerCase();
  return typeHint ? `${meaning} (${typeHint})` : meaning;
}

// Reverse lookup: Turkish term → DB keyword(s)
const REVERSE_KEYWORD_MAP: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const [dbKey, turkishVal] of Object.entries(KEYWORD_MAP)) {
    for (const term of turkishVal.split("/")) {
      const lower = term.toLowerCase().trim();
      if (!map[lower]) map[lower] = [];
      map[lower].push(dbKey);
    }
  }
  return map;
})();

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u");
}

export function dbKeysForQuery(query: string): string[] {
  const queryLower = query.toLowerCase();
  const queryNorm = normalizeQuery(query);
  const matched: string[] = [];

  for (const [turkishTerm, dbKeys] of Object.entries(REVERSE_KEYWORD_MAP)) {
    const termNorm = normalizeQuery(turkishTerm);
    if (queryNorm.includes(termNorm) || queryLower.includes(turkishTerm)) {
      matched.push(...dbKeys);
    }
  }

  for (const word of queryLower.split(/\s+/).filter((w) => w.length > 2)) {
    const wordUpper = word.toUpperCase();
    if (KEYWORD_MAP[wordUpper]) matched.push(wordUpper);
  }

  return [...new Set(matched)];
}
