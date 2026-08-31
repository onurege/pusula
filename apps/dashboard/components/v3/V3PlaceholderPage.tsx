import { V3PageHeader } from "./V3PageHeader";

/**
 * V3 dashboard placeholder — Wietnauer'ın 7-madde isterindeki henüz
 * uygulanmamış dashboard'lar için. Yapılacaklar listesi + planlanan paneller +
 * ilerleme çubuğu gösterir; sunum sırasında "bu ekran henüz boş" hissi
 * vermesin.
 */
export function V3PlaceholderPage({
  no,
  eyebrow,
  title,
  description,
  dataNote,
  plannedPanels,
}: {
  no: string;
  eyebrow: string;
  title: string;
  description: string;
  dataNote?: string;
  plannedPanels: { label: string; status: "planlandı" | "hazırlanıyor" }[];
}) {
  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow={`Dashboard ${no}`}
        title={title}
        description={description}
        dataNote={dataNote}
      />

      <div className="v3-soon-card">
        <div className="v3-soon-icon">⏳</div>
        <div className="v3-soon-body">
          <div className="v3-soon-title">Bu dashboard hazırlanıyor</div>
          <div className="v3-soon-sub">
            {eyebrow} — Yönetim Kurulu (#1) sonrası bu sayfa aşağıdaki
            panellerle açılacak. SQL altyapısı ve tablo eşleştirmeleri yapıldı,
            UI gerekiyor.
          </div>
          <ul className="v3-soon-list">
            {plannedPanels.map((p) => (
              <li key={p.label}>
                <span className={`v3-soon-tag v3-tag-${p.status === "hazırlanıyor" ? "active" : "queued"}`}>
                  {p.status}
                </span>
                {p.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .v3-soon-card {
          display: flex;
          gap: 18px;
          background: var(--color-surface);
          border: 1px dashed var(--color-border-strong, var(--color-border));
          border-radius: 12px;
          padding: 24px 26px;
        }
        .v3-soon-icon {
          font-size: 32px;
          line-height: 1;
          flex-shrink: 0;
        }
        .v3-soon-body { flex: 1; }
        .v3-soon-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--color-fg);
          margin-bottom: 4px;
        }
        .v3-soon-sub {
          font-size: 13px;
          color: var(--color-muted);
          margin-bottom: 16px;
          line-height: 1.55;
          max-width: 620px;
        }
        .v3-soon-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .v3-soon-list li {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--color-fg-2);
          padding: 8px 12px;
          background: var(--color-surface-2);
          border-radius: 6px;
        }
        .v3-soon-tag {
          font-size: 10px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          flex-shrink: 0;
        }
        .v3-tag-active {
          background: var(--color-accent-soft);
          color: var(--color-accent);
        }
        .v3-tag-queued {
          background: var(--color-surface);
          color: var(--color-muted);
          border: 1px solid var(--color-border);
        }
      `,
        }}
      />
    </div>
  );
}
