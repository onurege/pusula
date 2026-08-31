"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminScreen } from "@/lib/content";
import { saveContentOverrides, resetAllContent } from "@/app/actions/content";

/**
 * Ekran-bazlı admin editörü. Sol menüden ekran seç → sadece o ekranın
 * başlık/açıklama/KPI/modül alanları gelir. hideKey'i olan öğelerde (KPI +
 * modül) aç/kapa (aktif/pasif) toggle'ı vardır. Boş bırakılan ad varsayılana
 * döner. Kaydet → override dosyasına yazar + tüm ekranlara canlı uygular.
 */
export function AdminEditor({
  screens,
  current,
}: {
  screens: AdminScreen[];
  current: Record<string, string>;
}) {
  const initial = useMemo(() => {
    const o: Record<string, string> = {};
    for (const s of screens)
      for (const g of s.groups)
        for (const it of g.items) {
          o[it.valueKey] = current[it.valueKey] ?? "";
          if (it.hideKey) o[it.hideKey] = current[it.hideKey] ?? "";
        }
    return o;
  }, [screens, current]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [active, setActive] = useState<string>(screens[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const dirty = useMemo(
    () => Object.keys(values).some((k) => values[k] !== initial[k]),
    [values, initial],
  );

  const screen = screens.find((s) => s.id === active) ?? screens[0];

  function save() {
    setMsg(null);
    const patch: Record<string, string | null> = {};
    for (const k of Object.keys(values)) {
      if (values[k] !== initial[k]) patch[k] = values[k].trim() === "" ? null : values[k];
    }
    if (Object.keys(patch).length === 0) return;
    startTransition(async () => {
      const res = await saveContentOverrides(patch);
      if (res.ok) {
        setMsg("Kaydedildi ✓ — tüm ekranlara uygulandı.");
        router.refresh();
      } else setMsg("Hata: " + res.error);
    });
  }

  function resetAll() {
    if (!confirm("Tüm özelleştirmeler silinsin ve varsayılana dönülsün mü?")) return;
    startTransition(async () => {
      const res = await resetAllContent();
      if (res.ok) {
        setValues(Object.fromEntries(Object.keys(values).map((k) => [k, ""])));
        setMsg("Tümü varsayılana döndürüldü.");
        router.refresh();
      } else setMsg("Hata: " + res.error);
    });
  }

  return (
    <div className="adm">
      <div className="adm-bar">
        <div className="adm-bar-info">
          {dirty ? "Kaydedilmemiş değişiklik var" : "Değişiklik yok"}
          {msg && <span className="adm-msg"> · {msg}</span>}
        </div>
        <div className="adm-bar-actions">
          <button type="button" className="adm-btn ghost" onClick={resetAll} disabled={pending}>
            Tümünü sıfırla
          </button>
          <button type="button" className="adm-btn primary" onClick={save} disabled={pending || !dirty}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </div>

      <div className="adm-layout">
        {/* Sol: ekran menüsü */}
        <nav className="adm-nav">
          {screens.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`adm-nav-item ${active === s.id ? "on" : ""}`}
              onClick={() => setActive(s.id)}
            >
              {s.name}
            </button>
          ))}
        </nav>

        {/* Sağ: seçili ekranın alanları */}
        <div className="adm-main">
          {screen?.groups.map((g) => (
            <section key={g.title} className="adm-sec">
              <h2 className="adm-sec-title">{g.title}</h2>
              <div className="adm-items">
                {g.items.map((it) => {
                  const hidden = it.hideKey ? values[it.hideKey] === "1" : false;
                  return (
                    <div key={it.valueKey} className="adm-item">
                      {it.hideKey && (
                        <button
                          type="button"
                          className={`adm-toggle ${hidden ? "" : "on"}`}
                          onClick={() =>
                            setValues((v) => ({ ...v, [it.hideKey!]: hidden ? "" : "1" }))
                          }
                          title={hidden ? "Pasif — aktif etmek için tıkla" : "Aktif — pasif etmek için tıkla"}
                          aria-pressed={!hidden}
                        >
                          <span className="adm-toggle-knob" />
                        </button>
                      )}
                      <div className="adm-item-body">
                        <span className="adm-label">
                          {it.label}
                          {it.hideKey && (
                            <span className={`adm-state ${hidden ? "off" : "onx"}`}>
                              {hidden ? "pasif" : "aktif"}
                            </span>
                          )}
                        </span>
                        {it.toggleOnly ? null : it.multiline ? (
                          <textarea
                            className="adm-input"
                            rows={2}
                            value={values[it.valueKey] ?? ""}
                            placeholder={it.default}
                            onChange={(e) => setValues((v) => ({ ...v, [it.valueKey]: e.target.value }))}
                            style={hidden ? { opacity: 0.5 } : undefined}
                          />
                        ) : (
                          <input
                            className="adm-input"
                            value={values[it.valueKey] ?? ""}
                            placeholder={it.default}
                            onChange={(e) => setValues((v) => ({ ...v, [it.valueKey]: e.target.value }))}
                            style={hidden ? { opacity: 0.5 } : undefined}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <style jsx>{`
        .adm { display: flex; flex-direction: column; gap: 16px; }
        .adm-bar {
          position: sticky; top: 56px; z-index: 20;
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 12px 16px; background: var(--color-surface);
          border: 1px solid var(--color-border); border-radius: 10px; box-shadow: var(--shadow-sm);
        }
        .adm-bar-info { font-size: 12.5px; color: var(--color-muted); }
        .adm-msg { color: var(--color-accent); font-weight: 500; }
        .adm-bar-actions { display: flex; gap: 8px; }
        .adm-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: all .15s; }
        .adm-btn.primary { background: var(--color-accent); color: var(--color-accent-fg); }
        .adm-btn.primary:hover:not(:disabled) { background: var(--color-accent-hover); }
        .adm-btn.ghost { background: transparent; color: var(--color-muted); border-color: var(--color-border); }
        .adm-btn.ghost:hover:not(:disabled) { color: var(--color-fg); }
        .adm-btn:disabled { opacity: .5; cursor: not-allowed; }

        .adm-layout { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 900px) { .adm-layout { grid-template-columns: 220px 1fr; align-items: start; } }
        .adm-nav {
          display: flex; flex-direction: column; gap: 2px; padding: 8px;
          background: var(--color-surface); border: 1px solid var(--color-border);
          border-radius: 12px; position: sticky; top: 116px;
        }
        .adm-nav-item {
          text-align: left; padding: 9px 12px; border-radius: 8px; border: 0;
          background: transparent; color: var(--color-fg-2); font-size: 13px; font-weight: 500;
          cursor: pointer; transition: all .12s;
        }
        .adm-nav-item:hover { background: var(--color-surface-2); color: var(--color-fg); }
        .adm-nav-item.on { background: var(--color-accent-soft); color: var(--color-accent); font-weight: 600; }

        .adm-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .adm-sec { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 18px 20px; }
        .adm-sec-title { font-size: 14px; font-weight: 600; color: var(--color-fg); margin: 0 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--color-border); }
        .adm-items { display: flex; flex-direction: column; gap: 12px; }
        .adm-item { display: flex; align-items: flex-start; gap: 10px; }
        .adm-item-body { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .adm-label { font-size: 12px; font-weight: 500; color: var(--color-fg-2); display: flex; align-items: center; gap: 8px; }
        .adm-state { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 1px 6px; border-radius: 4px; }
        .adm-state.onx { background: var(--color-accent-soft); color: var(--color-accent); }
        .adm-state.off { background: var(--color-surface-3); color: var(--color-muted); }
        .adm-input { width: 100%; box-sizing: border-box; padding: 8px 11px; font-size: 13px; color: var(--color-fg); font-family: inherit; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 7px; }
        .adm-input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }

        .adm-toggle { flex: none; margin-top: 20px; width: 38px; height: 22px; border-radius: 999px; padding: 2px; background: var(--color-surface-3); border: 1px solid var(--color-border); cursor: pointer; transition: background .15s; display: flex; align-items: center; }
        .adm-toggle.on { background: var(--color-accent); border-color: var(--color-accent); }
        .adm-toggle-knob { width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: transform .15s; }
        .adm-toggle.on .adm-toggle-knob { transform: translateX(16px); }
      `}</style>
    </div>
  );
}
