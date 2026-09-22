import Link from "next/link";
import {
  PieChart,
  TrendingUp,
  Users,
  Package,
  Truck,
  Target,
  Wallet,
} from "lucide-react";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { getTenantConfig } from "@/lib/tenant";
import { getContentMap } from "@/lib/content";
import { getLocale, t as translate } from "@/lib/i18n";

export async function generateMetadata() {
  const locale = await getLocale();
  return { title: `${translate(locale, "v3.landing.metaTitle", "V3 Özet")} · Insider` };
}

/**
 * V3 landing — dashboard'lara tek tık erişim. Her kart:
 *   - eyebrow numara
 *   - başlık + 1-cümle açıklama
 *   - "hazır" / "geliyor" status badge
 *
 * Wietnauer'ın 7-madde isterinde tek tek dashboard sayfası açma talebine
 * karşılık tasarlandı.
 *
 * i18n: demo TR/EN toggle bu ekranı kapsar (bkz. `lib/i18n.ts`). İçerik
 * override sistemi kazanır — admin panelinden özelleştirilmiş bir metin
 * varsa locale'den bağımsız aynen gösterilir; yoksa TR varsayılan/EN
 * karşılığı `resolve()` ile seçilir.
 */
export default async function V3LandingPage() {
  const tenant = getTenantConfig();
  const content = getContentMap();
  const locale = await getLocale();

  const resolve = (key: string, trDefault: string): string => {
    const override = content[key];
    return override != null && override !== "" ? override : translate(locale, key, trDefault);
  };

  return (
    <div className="v3-page">
      <V3PageHeader
        locale={locale}
        eyebrow={resolve("v3.landing.eyebrow", "V3 · Özet")}
        title={`${tenant.displayName} — ${resolve("page.ozet.title", "Yönetim Paneli")}`}
        description={resolve(
          "v3.landing.desc",
          "Sekiz dashboard, sekiz soru: yönetici özeti, satış performansı, müşteri segmenti, marka katkısı, stok tükenme, saha operasyonu, müşteri sağlığı ve ticari yatırım. Her kart kendi sayfasında açılır.",
        )}
      />

      <div className="v3-card-grid">
        {NAV_CARDS.map((c) => (
          <Link key={c.href} href={c.href} className={`v3-card ${c.ready ? "ready" : ""}`}>
            <div className="v3-card-num">{c.no}</div>
            <div className="v3-card-icon" style={{ color: c.accent }}>
              <c.icon size={22} strokeWidth={1.7} />
            </div>
            <div className="v3-card-title">{resolve(`v3.landing.card.${c.key}.title`, c.title)}</div>
            <div className="v3-card-desc">{resolve(`v3.landing.card.${c.key}.desc`, c.desc)}</div>
            <div className="v3-card-foot">
              {c.ready ? (
                <span className="v3-card-badge ready">{resolve("v3.landing.badge.ready", "Hazır")}</span>
              ) : (
                <span className="v3-card-badge soon">{resolve("v3.landing.badge.soon", "Hazırlanıyor")}</span>
              )}
              <span className="v3-card-arrow">→</span>
            </div>
          </Link>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .v3-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 14px;
        }
        .v3-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 18px 18px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          text-decoration: none;
          color: inherit;
          transition: border-color 0.15s, transform 0.1s;
          position: relative;
        }
        .v3-card:hover {
          border-color: var(--color-accent);
          transform: translateY(-1px);
        }
        .v3-card.ready { border-color: var(--color-accent-soft); }
        .v3-card-num {
          font-size: 10.5px;
          font-weight: 600;
          color: var(--color-muted);
          letter-spacing: 0.06em;
        }
        .v3-card-icon {
          margin-top: 2px;
          margin-bottom: 4px;
        }
        .v3-card-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--color-fg);
          letter-spacing: -0.01em;
          line-height: 1.2;
        }
        .v3-card-desc {
          font-size: 12.5px;
          color: var(--color-muted);
          line-height: 1.5;
          flex: 1;
        }
        .v3-card-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 6px;
        }
        .v3-card-badge {
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 3px 7px;
          border-radius: 4px;
        }
        .v3-card-badge.ready {
          background: var(--color-accent-soft);
          color: var(--color-accent);
        }
        .v3-card-badge.soon {
          background: var(--color-surface-2);
          color: var(--color-muted);
          border: 1px solid var(--color-border);
        }
        .v3-card-arrow {
          color: var(--color-muted-2);
          font-size: 14px;
          transition: transform 0.15s;
        }
        .v3-card:hover .v3-card-arrow {
          transform: translateX(2px);
          color: var(--color-accent);
        }
      `,
        }}
      />
    </div>
  );
}

const NAV_CARDS = [
  {
    no: "01",
    key: "yonetim",
    href: "/v3/yonetim-kurulu",
    title: "Yönetim Kurulu",
    desc: "Top 10/20/50 müşteri, marka katkıları, iskonto KPI. CEO sabah görünümü.",
    icon: PieChart,
    accent: "#6366f1",
    ready: true,
  },
  {
    no: "02",
    key: "satis",
    href: "/v3/satis-performans",
    title: "Satış Performans",
    desc: "Distribütör/ekip/temsilci, drop size, aktif + yeni müşteri kazanımı.",
    icon: TrendingUp,
    accent: "#16a34a",
    ready: true,
  },
  {
    no: "03",
    key: "segment",
    href: "/v3/musteri-segmentasyon",
    title: "Müşteri Segmentasyon",
    desc: "3 ayrı segment boyutu yan yana — kanal × ciro × iskonto cross.",
    icon: Users,
    accent: "#0891b2",
    ready: true,
  },
  {
    no: "04",
    key: "marka",
    href: "/v3/marka-sku",
    title: "Marka & SKU",
    desc: "Marka penetrasyonu, Top 5 SKU, stratejik marka özel zoom panelleri.",
    icon: Package,
    accent: "#9333ea",
    ready: true,
  },
  {
    no: "05",
    key: "stok",
    href: "/v3/stok-tukenme",
    title: "Stok Tükenme",
    desc: "SKU bazında kalan gün, tahmini tükenme tarihi ve miktar bazlı 90g devir.",
    icon: Package,
    accent: "#0f766e",
    ready: true,
  },
  {
    no: "06",
    key: "saha",
    href: "/v3/saha-operasyon",
    title: "Saha Operasyon",
    desc: "Günlük/haftalık ziyaret trendleri, kapsama, sipariş dönüşümü.",
    icon: Truck,
    accent: "#d97706",
    ready: true,
  },
  {
    no: "07",
    key: "risk",
    href: "/v3/aktivasyon-risk",
    title: "Aktivasyon & Risk",
    desc: "Pasifleşen müşteri, stratejik marka sessizliği, yeniden kazanım.",
    icon: Target,
    accent: "#dc2626",
    ready: true,
  },
  {
    no: "08",
    key: "iskonto",
    href: "/v3/ticari-yatirim",
    title: "Ticari Yatırım & İskonto",
    desc: "İskonto harcaması, marka × etkinlik, müşteri/segment ROI.",
    icon: Wallet,
    accent: "#b45309",
    ready: true,
  },
];
