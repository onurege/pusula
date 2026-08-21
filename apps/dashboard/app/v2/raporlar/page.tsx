import Link from "next/link";
import {
  Database,
  FileBarChart2,
  FileText,
  Plus,
  Sparkles,
} from "lucide-react";
import { listReports, type ReportSummary } from "@/lib/api";

// `force-dynamic` kaldırıldı — Data Cache 5 dk RAM'de tutsun diye.
export const metadata = { title: "Raporlar · V2 · Insider" };

/**
 * V2 Raporlar — Raporlar + Yeni Rapor + Şema buraya konsolide.
 * Mevcut /reports sayfasının canlı listesini çekip burada gösterir, ayrıca
 * Yeni Rapor ve Şema'ya kart-bazlı erişim verir.
 */
export default async function V2RaporlarPage() {
  let reports: ReportSummary[] = [];
  let listError: string | null = null;
  try {
    reports = await listReports();
  } catch (err) {
    listError = err instanceof Error ? err.message : "Bilinmeyen hata";
  }

  return (
    <div className="komuta-root">
      <header className="komuta-page-header">
        <div className="komuta-page-header-main">
          <div className="komuta-eyebrow">
            <span className="komuta-eyebrow-dot" />
            Raporlar
          </div>
          <h1 className="komuta-page-title">Raporlar + BI + Şema</h1>
          <p className="komuta-page-desc">
            Kayıtlı raporlar, Gemini destekli SQL üretici ve Univera şema
            gezgini tek yerden.
          </p>
        </div>
      </header>

      {/* 3 ana eylem kartı — kullanıcı hızlıca aksiyon alabilsin */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 12,
          marginBottom: 16,
        }}
        className="v2rep-action-grid"
      >
        <ActionCard
          href="/reports/new"
          icon={<Plus size={18} />}
          eyebrow="Yeni rapor"
          title="Gemini SQL Üretici"
          desc="Düz Türkçe ile soru yaz → SQL üret + sonuç gör + raporu kaydet."
          color="#6366f1"
          primary
        />
        <ActionCard
          href="/reports"
          icon={<FileBarChart2 size={18} />}
          eyebrow="Kayıtlı raporlar"
          title="Rapor Listesi"
          desc={
            listError
              ? "Liste alınamadı"
              : `${reports.length} kayıtlı rapor — tıkla, sonucu çalıştır.`
          }
          color="#16a34a"
        />
        <ActionCard
          href="/schema"
          icon={<Database size={18} />}
          eyebrow="Veri kaynağı"
          title="Univera Şema Gezgini"
          desc="500+ tablo, kolon adları, FK ilişkileri. Yeni rapor için ilham."
          color="#9333ea"
        />
      </div>

      {/* Kayıtlı raporlar canlı listesi (top 8) */}
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          padding: "14px 18px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                color: "var(--color-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                fontWeight: 700,
              }}
            >
              Son raporlar
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-muted)",
                fontStyle: "italic",
                marginTop: 2,
              }}
            >
              En yeni güncellenen ilk 8 rapor
            </div>
          </div>
          <Link
            href="/reports"
            style={{
              fontSize: 12,
              color: "var(--color-accent)",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Tümünü gör →
          </Link>
        </div>

        {listError ? (
          <div
            style={{
              padding: 12,
              background: "var(--color-bad-soft)",
              border: "1px solid var(--color-bad)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--color-bad)",
            }}
          >
            Liste alınamadı: <code style={{ fontSize: 11 }}>{listError}</code>
          </div>
        ) : reports.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--color-muted)",
              fontSize: 12,
            }}
          >
            Henüz kayıtlı rapor yok.{" "}
            <Link
              href="/reports/new"
              style={{
                color: "var(--color-accent)",
                fontWeight: 600,
                textDecoration: "underline",
              }}
            >
              İlk raporu oluştur
            </Link>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 6,
            }}
          >
            {reports.slice(0, 8).map((r) => (
              <ReportRow key={r.id} report={r} />
            ))}
          </div>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media (min-width: 800px) {
          .v2rep-action-grid { grid-template-columns: 1.4fr 1fr 1fr !important; }
        }
      `,
        }}
      />
    </div>
  );
}

function ActionCard({
  href,
  icon,
  eyebrow,
  title,
  desc,
  color,
  primary,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  desc: string;
  color: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        background: primary
          ? `linear-gradient(135deg, ${color}18 0%, var(--color-surface) 60%)`
          : "var(--color-surface)",
        border: "1px solid var(--color-border-strong)",
        borderTop: `3px solid ${color}`,
        borderRadius: 10,
        padding: "14px 16px",
        textDecoration: "none",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        transition: "all 0.15s",
      }}
      className="v2rep-action-card"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color,
        }}
      >
        {icon}
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.6px",
            fontWeight: 700,
          }}
        >
          {eyebrow}
          {primary && (
            <Sparkles
              size={10}
              style={{ marginLeft: 4, display: "inline" }}
            />
          )}
        </span>
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "var(--color-fg)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--color-muted)",
          lineHeight: 1.4,
        }}
      >
        {desc}
      </div>
    </Link>
  );
}

function ReportRow({ report }: { report: ReportSummary }) {
  return (
    <Link
      href={`/reports/${encodeURIComponent(report.id)}`}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "8px 10px",
        background: "var(--color-surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        textDecoration: "none",
        fontSize: 12,
        transition: "background 0.12s",
      }}
      className="v2rep-row"
    >
      <FileText size={14} style={{ color: "var(--color-muted)" }} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: "var(--color-fg)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {report.name}
        </div>
        {report.description && (
          <div
            style={{
              color: "var(--color-muted)",
              fontSize: 10.5,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {report.description}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {new Date(report.updatedAt).toLocaleDateString("tr-TR", {
          dateStyle: "short",
        })}
      </div>
    </Link>
  );
}
