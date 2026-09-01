import Link from "next/link";
import { getContentMap, ADMIN_SCREENS } from "@/lib/content";
import { AdminEditor } from "@/components/admin/AdminEditor";
import { GlobalRefreshButton } from "@/components/global-refresh-button";

export const metadata = { title: "Admin · Insider" };

/**
 * Demo admin paneli — ekran-bazlı içerik yönetimi. Sol menüden ekran seç →
 * o ekranın başlık/açıklama/KPI/modül alanları gelir; KPI ve modüller aç/kapa
 * (aktif/pasif) edilebilir, adları değiştirilebilir. Değişiklikler tenant-bazlı
 * override dosyasına yazılır, tüm ekranlara canlı uygulanır.
 */
export default function AdminPage() {
  const current = getContentMap();

  return (
    <div className="v3-page" style={{ padding: "4px 0 24px" }}>
      <header style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--color-border)" }}>
        <div
          style={{
            fontSize: 10.5, fontWeight: 600, color: "var(--color-accent)",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}
        >
          Admin · İçerik Yönetimi
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: "var(--color-fg)", letterSpacing: "-0.025em", margin: "4px 0 6px" }}>
          Ekran Yönetimi
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--color-muted)", margin: 0, maxWidth: 720 }}>
          Sol menüden bir ekran seç — o ekranın başlığı, açıklaması, KPI kartları
          ve modülleri gelir. KPI ve kutuları <strong>aktif/pasif</strong> edebilir,
          adlarını değiştirebilirsin. Boş bırakılan ad varsayılana döner.
          Kaydettiğinde tüm ekranlara anında uygulanır.
        </p>
        <Link href="/admin/yetkiler" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent)" }}>
          → Kullanıcı Yetkileri (ekran + distribütör erişimi)
        </Link>
      </header>

      {/* Veri Yönetimi — ağır tam-yenileme yalnızca burada (navbar'dan kaldırıldı).
          Normal kullanıcılar datayı yormasın; gerektiğinde admin buradan tetikler.
          Veriler zaten her gece 03:00'te otomatik tazeleniyor. */}
      <section
        style={{
          marginBottom: 24, padding: "18px 20px", borderRadius: 10,
          border: "1px solid var(--color-border)", background: "var(--color-surface, #fff)",
          display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14,
        }}
      >
        <div style={{ maxWidth: 560 }}>
          <div
            style={{
              fontSize: 10.5, fontWeight: 600, color: "var(--color-accent)",
              letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4,
            }}
          >
            Veri Yönetimi
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-fg)", marginBottom: 2 }}>
            Veriyi Yenile
          </div>
          <p style={{ fontSize: 12.5, color: "var(--color-muted)", margin: 0, lineHeight: 1.5 }}>
            Tüm snapshot’ları ve harita aynasını canlı MSSQL’den yeniden hesaplar
            (“bugün” çapası dahil). Ağır bir işlemdir; gün içinde nadiren gerekir —
            veriler zaten her gece 03:00’te otomatik tazeleniyor. Yalnızca admin.
          </p>
        </div>
        <GlobalRefreshButton />
      </section>

      <AdminEditor screens={ADMIN_SCREENS} current={current} />
    </div>
  );
}
