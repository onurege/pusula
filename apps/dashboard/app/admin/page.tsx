import Link from "next/link";
import { getContentMap, ADMIN_SCREENS } from "@/lib/content";
import { AdminEditor } from "@/components/admin/AdminEditor";

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

      <AdminEditor screens={ADMIN_SCREENS} current={current} />
    </div>
  );
}
