import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { KOMUTA_CSS } from "@/components/komuta/komuta-css";

export const metadata: Metadata = {
  title: "Insider · V2 Beta",
};

/**
 * V2 namespace layout — root layout'u sarmalıyor (navbar / theme / drawer
 * orada). Burada sadece V2 modunda olduğunu belirten ince bir banner var
 * ki kullanıcı "geri V1'e nasıl dönerim" sorusunu sormak zorunda kalmasın.
 */
export default function V2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="v2-root">
      {/* KOMUTA_CSS — V1 ile aynı palette/panel CSS'i. V2 panellerinin
          `.panel`, `.kpi-card`, `.heatmap-grid` vb. class'ları için gerekli. */}
      <style dangerouslySetInnerHTML={{ __html: KOMUTA_CSS }} />
      <div className="v2-beta-banner">
        <Sparkles size={11} className="opacity-80" />
        <span className="v2-beta-label">V2 Beta</span>
        <span className="v2-beta-hint">
          Yeni IA — sadeleştirilmiş Müşteri / Ürün / Saha sekme yapısı.
          V1 ile aynı veri; sadece yerleşim farklı.
        </span>
        <Link href="/" className="v2-beta-link">
          ← V1'e dön
        </Link>
      </div>
      {children}

      <style>{`
        .v2-beta-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          margin: 0 auto;
          max-width: 1600px;
          font-size: 11px;
          color: var(--color-accent);
        }
        .v2-beta-label {
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .v2-beta-hint {
          color: var(--color-muted);
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .v2-beta-link {
          color: var(--color-muted);
          text-decoration: none;
          padding: 2px 8px;
          border-radius: 4px;
          transition: background 0.12s, color 0.12s;
        }
        .v2-beta-link:hover {
          background: var(--color-surface-2);
          color: var(--color-fg);
        }
      `}</style>
    </div>
  );
}
