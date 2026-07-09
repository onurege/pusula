/**
 * V3 sayfaları için ortak header bandı. Eyebrow + büyük başlık + alt-açıklama
 * + sağ tarafa kısa data-source info. Tüm 7 dashboard sayfasında aynı
 * yerleşim.
 */
export function V3PageHeader({
  eyebrow,
  title,
  description,
  dataNote,
  generatedAt,
}: {
  eyebrow: string;
  title: string;
  description: string;
  dataNote?: string;
  generatedAt?: string;
}) {
  const ts = generatedAt
    ? new Date(generatedAt).toLocaleString("tr-TR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return (
    <header className="v3-head">
      <div className="v3-head-main">
        <div className="v3-eyebrow">
          <span className="v3-eyebrow-dot" />
          {eyebrow}
        </div>
        <h1 className="v3-title">{title}</h1>
        <p className="v3-desc">{description}</p>
      </div>
      {(dataNote || ts) && (
        <aside className="v3-meta">
          {dataNote && <div className="v3-meta-note">{dataNote}</div>}
          {ts && <div className="v3-meta-ts">son güncelleme · {ts}</div>}
        </aside>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--color-border); flex-wrap: wrap; }
        .v3-head-main { min-width: 280px; flex: 1; }
        .v3-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 600; color: var(--color-accent); letter-spacing: 0.06em; text-transform: uppercase; }
        .v3-eyebrow-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); }
        .v3-title { font-size: 28px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.025em; margin: 4px 0 6px; line-height: 1.15; }
        .v3-desc { font-size: 13.5px; color: var(--color-muted); margin: 0; max-width: 720px; line-height: 1.55; }
        .v3-meta { font-size: 11px; color: var(--color-muted-2); text-align: right; max-width: 280px; }
        .v3-meta-note { line-height: 1.5; }
        .v3-meta-ts { margin-top: 6px; opacity: 0.8; font-variant-numeric: tabular-nums; }
      `,
        }}
      />
    </header>
  );
}
