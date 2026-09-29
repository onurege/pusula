"use client";

import { useCallback, useEffect, useState } from "react";
import { type DatabaseEntry, type SaveMsg, friendlyError, readJson } from "./types";

/**
 * F) Veritabanları (çok-DB) — login'de DB seçimi. Aynı sunucu/kimlik (E. DB
 * Bağlantısı'ndaki), farklı `database`. Kodsuz: kurulumcu {etiket, database
 * adı} satırları ekler. **2 veya daha fazla** satır → login ekranında dropdown
 * çıkar; **0-1 satır** → tek-DB (dropdown gizli, E. bölümündeki `database`
 * kullanılır). `id` verilmezse etiketten türetilir (backend). Kayıt, aktif
 * bağlantı havuzlarını tazeler (bir DB adı değişmişse yakalansın).
 */
type Row = { key: number; label: string; database: string; id: string };

let keySeq = 0;
function toRow(e: Partial<DatabaseEntry>): Row {
  return { key: keySeq++, label: e.label ?? "", database: e.database ?? "", id: e.id ?? "" };
}

export function DatabasesSection() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<SaveMsg | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/config/databases", { cache: "no-store" });
      const { data, errorMessage } = await readJson<{ databases: DatabaseEntry[] }>(res);
      if (!data) {
        setLoadError(friendlyError(new Error("empty body"), errorMessage));
        return;
      }
      setRows((data.databases ?? []).map(toRow));
    } catch (e) {
      setLoadError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setSaveMsg(null);
  }
  function addRow() {
    setRows((rs) => [...rs, toRow({})]);
    setSaveMsg(null);
  }
  function removeRow(key: number) {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setSaveMsg(null);
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = rows.map((r) => ({
        // Boş id gönder → backend etiketten türetir (slugify).
        id: r.id.trim() || undefined,
        label: r.label.trim(),
        database: r.database.trim(),
      }));
      const res = await fetch("/api/admin/config/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ databases: payload }),
      });
      const { data, errorMessage } = await readJson<{ ok: true; databases: DatabaseEntry[] }>(res);
      if (!data?.ok) {
        setSaveMsg({ tone: "bad", text: friendlyError(new Error("save failed"), errorMessage) });
        return;
      }
      setRows((data.databases ?? []).map(toRow)); // normalize edilmiş (türetilen id'ler) geri gelir
      const count = data.databases?.length ?? 0;
      setSaveMsg({
        tone: "good",
        text:
          count >= 2
            ? `Kaydedildi ✓ — login ekranında ${count} veritabanı seçeneği görünecek.`
            : "Kaydedildi ✓ — 2'den az giriş olduğu için login'de seçici görünmez (tek-DB).",
      });
    } catch (e) {
      setSaveMsg({ tone: "bad", text: friendlyError(e) });
    } finally {
      setSaving(false);
    }
  }

  const activeCount = rows.filter((r) => r.label.trim() && r.database.trim()).length;

  return (
    <section className="ik-card" aria-labelledby="ik-dbs-h2">
      <h2 className="ik-h2" id="ik-dbs-h2">F. Veritabanları (çok-DB · login&apos;de seçim)</h2>
      <p className="ik-sub">
        Aynı sunucu ve kullanıcıda birden çok veritabanı varsa (E. DB Bağlantısı
        bilgileriyle aynı sunucu/kimlik) buraya her biri için bir satır ekleyin.
        <strong> 2 veya daha fazla</strong> satır olduğunda kullanıcılar login
        ekranında hangi veritabanına gireceğini seçer; <strong>0-1 satır</strong>
        olduğunda seçici çıkmaz ve E. bölümündeki veritabanı kullanılır.
      </p>

      {loading && (
        <div aria-live="polite" aria-busy="true">
          <div className="ik-skeleton" style={{ width: "50%", marginBottom: 8 }} />
          <div className="ik-skeleton" style={{ width: "80%" }} />
        </div>
      )}

      {!loading && loadError && (
        <div role="alert" className="ik-msg bad" style={{ marginBottom: 12 }}>
          Yüklenemedi: {loadError}{" "}
          <button type="button" className="ik-btn ghost" onClick={() => void load()} style={{ marginLeft: 8 }}>
            Tekrar dene
          </button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          {rows.length === 0 && (
            <p className="ik-muted" style={{ marginBottom: 12 }}>
              Henüz veritabanı eklenmedi — tek-DB modunda çalışıyor. Çoklu seçim
              için “+ Veritabanı ekle”ye basın.
            </p>
          )}

          {rows.map((r) => (
            <div
              key={r.key}
              style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap" }}
            >
              <label className="ik-field" style={{ flex: 2, minWidth: 160 }}>
                <span className="ik-label">Etiket (login&apos;de görünen ad)</span>
                <input
                  className="ik-input"
                  value={r.label}
                  onChange={(e) => update(r.key, { label: e.target.value })}
                  placeholder="ör. Reckitt Core"
                  autoComplete="off"
                />
              </label>
              <label className="ik-field" style={{ flex: 2, minWidth: 160 }}>
                <span className="ik-label">Veritabanı adı (MSSQL)</span>
                <input
                  className="ik-input"
                  value={r.database}
                  onChange={(e) => update(r.key, { database: e.target.value })}
                  placeholder="ör. RBHYHO"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                className="ik-btn ghost"
                style={{ alignSelf: "flex-end", marginBottom: 1, whiteSpace: "nowrap" }}
                onClick={() => removeRow(r.key)}
                aria-label="Bu satırı kaldır"
                disabled={saving}
              >
                Kaldır
              </button>
            </div>
          ))}

          <div className="ik-actions">
            <button type="button" className="ik-btn ghost ik-actions-left" onClick={addRow} disabled={saving}>
              + Veritabanı ekle
            </button>
            {saveMsg && (
              <span role="status" className={`ik-msg ${saveMsg.tone}`} style={{ marginRight: "auto" }}>
                {saveMsg.text}
              </span>
            )}
            <span className="ik-badge neutral">{activeCount} geçerli satır</span>
            <button type="button" className="ik-btn primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
