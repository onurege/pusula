"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Kart başlığı (örn. "Nasıl hesaplandı?") */
  title?: string;
  /** Veri kaynağı (örn. "TBLMSDFATURA × TBLMUSTERI") */
  source: string;
  /** Zaman penceresi (örn. "Son 30 gün (DATEADD(day,-30, GETDATE()))") */
  window: string;
  /** Hesaplanan baz değer (örn. "SUM(DBLNETTUTAR), BYTTUR=0 AND BYTDURUM=0") */
  base: string;
  /** Ek notlar (filtre, JOIN trap'ları, vb.) — opsiyonel */
  notes?: string[];
  /** Açıklama altında gösterilecek tam SQL özet (collapsible) — opsiyonel */
  sql?: string;
};

/**
 * Komuta panel başlıklarının yanına yerleştirilen ⓘ rozeti. Click → küçük
 * popover açar; kullanıcı "bu sayı neye göre hesaplandı" sorusuna cevap
 * verebilir. Sayfa scroll'unda popover el ile kapatılır.
 *
 * Erişilebilirlik: <button type="button"> + aria-label. Esc + dış tıklama
 * kapatır. Focus trap yok (popover küçük, dismissible).
 */
export function InfoHint({ title = "Nasıl hesaplandı?", source, window, base, notes, sql }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="ih-wrap">
      <button
        type="button"
        className={`ih-btn${open ? " open" : ""}`}
        aria-label={title}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⓘ
      </button>
      {open && (
        <div className="ih-popover" role="dialog">
          <div className="ih-pop-title">{title}</div>
          <dl className="ih-pop-list">
            <dt>Kaynak</dt>
            <dd>{source}</dd>
            <dt>Pencere</dt>
            <dd>{window}</dd>
            <dt>Baz</dt>
            <dd>{base}</dd>
          </dl>
          {notes && notes.length > 0 && (
            <ul className="ih-pop-notes">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {sql && (
            <details className="ih-pop-sql">
              <summary>SQL özeti</summary>
              <pre>{sql}</pre>
            </details>
          )}
        </div>
      )}
      <style jsx>{`
        .ih-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          margin-left: 4px;
        }
        .ih-btn {
          appearance: none;
          background: transparent;
          border: 1px solid var(--color-border-strong);
          color: var(--color-muted);
          width: 18px;
          height: 18px;
          border-radius: 50%;
          font-size: 11px;
          line-height: 1;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: color 0.12s, border-color 0.12s, background 0.12s;
        }
        .ih-btn:hover, .ih-btn.open {
          color: var(--color-accent);
          border-color: var(--color-accent);
          background: var(--color-accent-soft);
        }
        .ih-popover {
          position: absolute;
          top: calc(100% + 6px);
          left: -8px;
          z-index: 90;
          width: min(360px, 80vw);
          background: var(--color-surface);
          border: 1px solid var(--color-border-strong);
          border-radius: 8px;
          box-shadow: var(--shadow-lg);
          padding: 12px 14px;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
          font-size: 12px;
          color: var(--color-fg-2);
          line-height: 1.5;
        }
        .ih-pop-title {
          font-size: 11px;
          color: var(--color-accent);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .ih-pop-list {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 4px 10px;
          margin: 0 0 8px 0;
        }
        .ih-pop-list dt {
          font-size: 10px;
          color: var(--color-muted-2);
          text-transform: uppercase;
          letter-spacing: 0.4px;
          font-weight: 600;
          padding-top: 1px;
        }
        .ih-pop-list dd {
          margin: 0;
          color: var(--color-fg);
          font-variant-numeric: tabular-nums;
        }
        .ih-pop-notes {
          margin: 6px 0 0 0;
          padding-left: 16px;
          color: var(--color-fg-2);
        }
        .ih-pop-notes li {
          margin: 2px 0;
        }
        .ih-pop-sql {
          margin-top: 10px;
          font-size: 11px;
          color: var(--color-muted);
        }
        .ih-pop-sql summary {
          cursor: pointer;
          user-select: none;
          padding: 2px 0;
        }
        .ih-pop-sql pre {
          margin: 6px 0 0 0;
          padding: 8px 10px;
          background: var(--color-surface-2);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10.5px;
          line-height: 1.45;
          color: var(--color-fg-2);
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 220px;
          overflow-y: auto;
        }
      `}</style>
    </span>
  );
}
