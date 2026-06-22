"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, MapPin, Trash2, User, X } from "lucide-react";
import {
  CHANGE_EVENT,
  clearActions,
  listActions,
  removeAction,
  type WeeklyAction,
  type WeeklyActionsChangedDetail,
} from "./store";

/**
 * Sağ alt köşede dolaşan haftalık aksiyon drawer'ı. Floating button + badge ile
 * her ekrandan görünür; açılınca sağ kenardan kayan panelde aksiyonları
 * listeler. Veri kaynağı tamamen client-side localStorage — backend yok.
 *
 * Birden fazla yerde mount edilmemeli (badge'ler çakışır). `app/layout.tsx`'te
 * tek seferlik render edilir.
 */
export function WeeklyActionsDrawer() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<WeeklyAction[]>([]);

  // Mount sonrası ilk hidrasyon — SSR'de window/localStorage yok, sıfır
  // aksiyonla render et, mount olunca gerçek listeyle güncelle.
  useEffect(() => {
    setMounted(true);
    setActions(listActions());
  }, []);

  // Store değişimlerini dinle — başka component (CustomerModal foresight
  // aksiyonu, FinanceAgentModal "ekle" CTA, başka tab) eklediğinde anında
  // güncellenelim.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<WeeklyActionsChangedDetail>).detail;
      if (detail && Array.isArray(detail.actions)) {
        setActions(detail.actions);
      } else {
        setActions(listActions());
      }
    };
    window.addEventListener(CHANGE_EVENT, handler);
    // Başka tab/window: storage event de yakalayalım (cross-tab sync)
    const storageHandler = (e: StorageEvent) => {
      if (e.key === "enroute:weekly-actions") {
        setActions(listActions());
      }
    };
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

  // ESC ile kapat
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const count = actions.length;

  const handleRemove = useCallback((id: string) => {
    removeAction(id);
  }, []);

  const handleClear = useCallback(() => {
    if (count === 0) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("Tüm aksiyonları silmek istediğinden emin misin?");
      if (!ok) return;
    }
    clearActions();
  }, [count]);

  // SSR'de hiç render etme — hidrasyon mismatch'i önlemek için.
  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Floating button — drawer kapalıyken görünür */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Bu hafta yapılacaklar (${count})`}
          className="fixed bottom-6 right-6 z-[55] inline-flex items-center gap-2 rounded-full bg-accent text-accent-fg px-4 h-12 shadow-lg shadow-accent/30 hover:bg-accent-hover transition-colors"
        >
          <ClipboardCheck size={18} />
          <span className="text-sm font-semibold tracking-tight">
            Bu hafta
          </span>
          <span
            className={
              "ml-0.5 inline-flex items-center justify-center min-w-[22px] h-[22px] rounded-full text-[11px] font-bold tabular-nums px-1.5 " +
              (count > 0
                ? "bg-white text-accent"
                : "bg-white/30 text-white/80")
            }
          >
            {count}
          </span>
        </button>
      )}

      {/* Backdrop + Drawer */}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex justify-end bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Bu hafta yapılacaklar"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[440px] h-full bg-surface border-l border-border shadow-2xl flex flex-col"
          >
            <DrawerHeader count={count} onClose={() => setOpen(false)} />
            <div className="flex-1 overflow-y-auto">
              {count === 0 ? (
                <EmptyState />
              ) : (
                <ul className="p-4 space-y-3">
                  {actions.map((a) => (
                    <ActionItem
                      key={a.id}
                      action={a}
                      onRemove={() => handleRemove(a.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
            {count > 0 && (
              <DrawerFooter onClear={handleClear} count={count} />
            )}
          </aside>
        </div>
      )}
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DrawerHeader({
  count,
  onClose,
}: {
  count: number;
  onClose: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border px-5 py-4 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-accent font-semibold">
          <ClipboardCheck size={11} />
          Demo Journey · Output
        </div>
        <h2 className="text-lg font-semibold tracking-tight mt-0.5">
          Bu hafta yapılacaklar{" "}
          <span className="text-muted-2 font-medium tabular-nums">
            ({count})
          </span>
        </h2>
        <p className="text-[11px] text-muted mt-0.5">
          AI önerilerini ve finans agentı aksiyonlarını burada topla.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Kapat"
        className="size-8 -mt-1 -mr-1 flex items-center justify-center rounded-md text-muted hover:text-fg hover:bg-surface-2 transition-colors"
      >
        <X size={18} />
      </button>
    </header>
  );
}

function DrawerFooter({
  onClear,
  count,
}: {
  onClear: () => void;
  count: number;
}) {
  return (
    <footer className="border-t border-border bg-surface-2/50 px-5 py-3 flex items-center justify-between text-[11px] text-muted">
      <span>
        {count} aksiyon ·{" "}
        <span className="text-muted-2">localStorage'da saklanır</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md border border-border bg-surface text-fg-2 hover:text-bad hover:border-bad/40 transition-colors"
      >
        <Trash2 size={11} />
        Tümünü temizle
      </button>
    </footer>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-16 flex flex-col items-center text-center gap-3">
      <div className="size-12 rounded-full bg-accent-soft flex items-center justify-center text-accent">
        <ClipboardCheck size={22} />
      </div>
      <div className="text-sm font-medium text-fg">Liste henüz boş.</div>
      <p className="text-xs text-muted leading-relaxed max-w-[280px]">
        Komuta'da finans agentı önerilerini, müşteri modalında 14 günlük
        foresight aksiyonlarını buraya ekleyebilirsin.
      </p>
    </div>
  );
}

function ActionItem({
  action,
  onRemove,
}: {
  action: WeeklyAction;
  onRemove: () => void;
}) {
  const addedRel = useMemo(() => formatRelative(action.addedAt), [action.addedAt]);
  const sourceLabel =
    action.source === "foresight"
      ? "Foresight"
      : action.source === "finance"
        ? "Finans Agentı"
        : "Manuel";
  const sourceTone =
    action.source === "foresight"
      ? "bg-accent-soft text-accent border-accent/30"
      : action.source === "finance"
        ? "bg-good-soft text-good border-good/30"
        : "bg-surface-2 text-fg-2 border-border";

  return (
    <li className="rounded-lg border border-border bg-surface p-3 shadow-xs hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm leading-snug text-fg flex-1">{action.text}</div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Aksiyonu sil"
          className="-mt-0.5 -mr-0.5 size-6 flex items-center justify-center rounded text-muted hover:text-bad hover:bg-bad-soft transition-colors"
        >
          <X size={14} />
        </button>
      </div>
      {action.reason && (
        <p className="mt-1.5 text-[11.5px] text-muted leading-relaxed">
          {action.reason}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px]">
        <span
          className={
            "inline-flex items-center px-1.5 h-[18px] rounded border font-medium tracking-tight " +
            sourceTone
          }
        >
          {sourceLabel}
        </span>
        {action.customerName && (
          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded border border-border bg-surface-2 text-fg-2">
            <User size={10} className="opacity-70" />
            <span className="truncate max-w-[140px]">{action.customerName}</span>
          </span>
        )}
        {action.region && (
          <span className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded border border-border bg-surface-2 text-fg-2">
            <MapPin size={10} className="opacity-70" />
            {action.region}
          </span>
        )}
        {action.productGroup && (
          <span className="inline-flex items-center px-1.5 h-[18px] rounded border border-border bg-surface-2 text-fg-2">
            {action.productGroup}
          </span>
        )}
        <span className="ml-auto text-muted-2 tabular-nums">{addedRel}</span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = Date.now() - t;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "şimdi";
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} sa önce`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}
