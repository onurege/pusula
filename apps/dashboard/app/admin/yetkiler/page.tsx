"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SCREENS } from "@/lib/screens";

type Perm = { admin?: boolean; screens: string[] | null; dists: number[] | null; cities: string[] | null };
type PermsMap = Record<string, Perm>;
type Dist = { id: number; ad: string };
type User = { username: string; displayName: string | null };

/**
 * Admin · Kullanıcı Yetkileri. Merkez kullanıcı username girip hangi ekranları
 * görebileceğini (checkbox) ve hangi DİSTRİBÜTÖRLERİN verisini görebileceğini
 * (çoklu seçim) atar. Distribütör listesi PANORAMA-otoriteli: yalnızca giriş
 * yapan admin'in kendi yetkili olduğu distribütörler gelir; dışına atama
 * yapılamaz (sunucu tarafı da eler). null/boş → kısıt yok (hepsi). Yetkiler
 * API'deki JSON store'a yazılır (MSSQL salt-okunur).
 */
export default function YetkilerPage() {
  const [perms, setPerms] = useState<PermsMap>({});
  const [dists, setDists] = useState<Dist[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // Form
  const [username, setUsername] = useState("");
  const [isAdminGrant, setIsAdminGrant] = useState(false);
  const [selScreens, setSelScreens] = useState<Set<string>>(new Set());
  const [selDists, setSelDists] = useState<Set<number>>(new Set());
  const [distFilter, setDistFilter] = useState("");
  const [allScreens, setAllScreens] = useState(true);
  const [allDists, setAllDists] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, d, u] = await Promise.all([
        fetch("/api/admin/perms", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/admin/dists", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setPerms(p.perms ?? {});
      setDists(d.dists ?? []);
      setUsers(u.users ?? []);
    } catch (e) {
      setMsg("Yükleme hatası: " + (e as Error).message);
    }
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  function editUser(u: string) {
    const p = perms[u];
    setUsername(u);
    setIsAdminGrant(!!p?.admin);
    setAllScreens(!p?.screens);
    setSelScreens(new Set(p?.screens ?? []));
    setAllDists(!p?.dists);
    setSelDists(new Set(p?.dists ?? []));
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!username.trim()) {
      setMsg("Kullanıcı adı gerekli");
      return;
    }
    setSaving(true);
    setMsg(null);
    const body = {
      username: username.trim(),
      admin: isAdminGrant,
      screens: allScreens ? null : [...selScreens],
      dists: allDists ? null : [...selDists],
    };
    try {
      const res = await fetch("/api/admin/perms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.ok) {
        setPerms(res.perms);
        setMsg("Kaydedildi ✓");
      } else setMsg("Hata: " + res.error);
    } catch (e) {
      setMsg("Hata: " + (e as Error).message);
    }
    setSaving(false);
  }

  async function remove(u: string) {
    if (!confirm(`${u} kaydı silinsin mi? (kısıtsıza döner)`)) return;
    const res = await fetch("/api/admin/perms/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u }),
    }).then((r) => r.json());
    if (res.ok) setPerms(res.perms);
  }

  const filteredDists = useMemo(
    () =>
      dists.filter((d) =>
        d.ad.toLocaleLowerCase("tr").includes(distFilter.toLocaleLowerCase("tr")),
      ),
    [dists, distFilter],
  );

  const screenLabel = (id: string) => SCREENS.find((s) => s.id === id)?.label ?? id;
  const distLabel = (id: number) => dists.find((d) => d.id === id)?.ad ?? `Dist ${id}`;

  return (
    <div className="v3-page" style={{ padding: "4px 0 24px" }}>
      <header style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--color-accent)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Admin · Yetkilendirme
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, color: "var(--color-fg)", letterSpacing: "-0.025em", margin: "4px 0 6px" }}>
          Kullanıcı Yetkileri
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--color-muted)", margin: "0 0 8px", maxWidth: 720 }}>
          <strong>Panorama'daki mevcut bir kullanıcıyı seç</strong> (yeni hesap
          açılmaz), hangi <strong>ekranları</strong> ve hangi{" "}
          <strong>distribütörlerin</strong> verisini görebileceğini belirle.
          Kullanıcı ve distribütör listeleri Panorama'dan gelir — yalnızca kendi
          yetkili olduğun distribütörleri atayabilirsin. "Hepsi" işaretliyse
          kısıt yok. Kayıtsız kullanıcı kısıtsızdır.
        </p>
        <Link href="/admin" className="yk-link">← İçerik yönetimine dön</Link>
      </header>

      {/* Form */}
      <section className="yk-card">
        <div className="yk-row">
          <label className="yk-field" style={{ maxWidth: 380 }}>
            <span className="yk-label">Kullanıcı (Panorama) — {users.length} kayıt</span>
            <select className="yk-input" value={username} onChange={(e) => setUsername(e.target.value)}>
              <option value="">— kullanıcı seç —</option>
              {users.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.username}{u.displayName ? ` — ${u.displayName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="yk-check" style={{ alignSelf: "flex-end", paddingBottom: 9 }}>
            <input type="checkbox" checked={isAdminGrant} onChange={(e) => setIsAdminGrant(e.target.checked)} />
            <strong>Admin yetkisi</strong> (içerik + kullanıcı yetkilendirme)
          </label>
        </div>

        <div className="yk-grid2">
          <div>
            <div className="yk-sub">
              <label className="yk-check">
                <input type="checkbox" checked={allScreens} onChange={(e) => setAllScreens(e.target.checked)} />
                Tüm ekranlar
              </label>
            </div>
            {!allScreens && (
              <div className="yk-screens">
                {SCREENS.map((s) => (
                  <label key={s.id} className="yk-check">
                    <input
                      type="checkbox"
                      checked={selScreens.has(s.id)}
                      onChange={(e) =>
                        setSelScreens((prev) => {
                          const n = new Set(prev);
                          e.target.checked ? n.add(s.id) : n.delete(s.id);
                          return n;
                        })
                      }
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="yk-sub">
              <label className="yk-check">
                <input type="checkbox" checked={allDists} onChange={(e) => setAllDists(e.target.checked)} />
                Tüm distribütörler
              </label>
              {!allDists && <span className="yk-count">{selDists.size} seçili</span>}
            </div>
            {!allDists && (
              <>
                <input className="yk-input" placeholder="distribütör ara…" value={distFilter} onChange={(e) => setDistFilter(e.target.value)} style={{ marginBottom: 8 }} />
                <div className="yk-cities">
                  {filteredDists.map((d) => (
                    <label key={d.id} className="yk-check">
                      <input
                        type="checkbox"
                        checked={selDists.has(d.id)}
                        onChange={(e) =>
                          setSelDists((prev) => {
                            const n = new Set(prev);
                            e.target.checked ? n.add(d.id) : n.delete(d.id);
                            return n;
                          })
                        }
                      />
                      {d.ad}
                    </label>
                  ))}
                  {filteredDists.length === 0 && <div className="yk-muted">Distribütör bulunamadı (Panorama yetkisi / API / VPN?).</div>}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="yk-actions">
          {msg && <span className="yk-msg">{msg}</span>}
          <button className="yk-btn primary" onClick={save} disabled={saving}>
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </section>

      {/* Mevcut kayıtlar */}
      <section className="yk-card">
        <h2 className="yk-h2">Kayıtlı yetkiler {loading && "· yükleniyor…"}</h2>
        {Object.keys(perms).length === 0 && !loading && <div className="yk-muted">Henüz kayıt yok — herkes kısıtsız.</div>}
        <div className="yk-list">
          {Object.entries(perms).map(([u, p]) => (
            <div key={u} className="yk-item">
              <div className="yk-item-main">
                <div className="yk-user">
                  {u}
                  {p.admin && <span className="yk-badge">ADMIN</span>}
                </div>
                <div className="yk-tags">
                  <span className="yk-tag">
                    Ekran: {p.screens ? p.screens.map(screenLabel).join(", ") : "hepsi"}
                  </span>
                  <span className="yk-tag">
                    Distribütör: {p.dists ? (p.dists.length > 4 ? `${p.dists.length} distribütör` : p.dists.map(distLabel).join(", ")) : "hepsi"}
                  </span>
                </div>
              </div>
              <div className="yk-item-actions">
                <button className="yk-btn ghost" onClick={() => editUser(u)}>Düzenle</button>
                <button className="yk-btn ghost" onClick={() => remove(u)}>Sil</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <style jsx>{`
        .yk-link { font-size: 12.5px; color: var(--color-accent); }
        .yk-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
        .yk-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
        .yk-field { display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .yk-label { font-size: 12px; font-weight: 500; color: var(--color-fg-2); }
        .yk-input { width: 100%; box-sizing: border-box; padding: 8px 11px; font-size: 13px; color: var(--color-fg); font-family: inherit; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 7px; }
        .yk-input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
        .yk-grid2 { display: grid; grid-template-columns: 1fr; gap: 20px; }
        @media (min-width: 900px) { .yk-grid2 { grid-template-columns: 1fr 1fr; } }
        .yk-sub { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .yk-count { font-size: 11px; color: var(--color-muted); }
        .yk-check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--color-fg); cursor: pointer; }
        .yk-screens { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
        .yk-cities { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px; max-height: 260px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: 8px; padding: 10px; }
        .yk-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 16px; }
        .yk-msg { font-size: 12.5px; color: var(--color-accent); font-weight: 500; }
        .yk-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
        .yk-btn.primary { background: var(--color-accent); color: var(--color-accent-fg); }
        .yk-btn.ghost { background: transparent; color: var(--color-muted); border-color: var(--color-border); }
        .yk-btn:disabled { opacity: .5; cursor: not-allowed; }
        .yk-h2 { font-size: 14px; font-weight: 600; color: var(--color-fg); margin: 0 0 12px; }
        .yk-list { display: flex; flex-direction: column; gap: 8px; }
        .yk-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: 8px; }
        .yk-user { font-size: 13px; font-weight: 600; color: var(--color-fg); display: flex; align-items: center; gap: 8px; }
        .yk-badge { font-size: 9.5px; font-weight: 700; letter-spacing: .04em; color: var(--color-accent-fg); background: var(--color-accent); padding: 2px 6px; border-radius: 5px; }
        .yk-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 3px; }
        .yk-tag { font-size: 11px; color: var(--color-muted); }
        .yk-item-actions { display: flex; gap: 6px; flex: none; }
        .yk-muted { font-size: 12.5px; color: var(--color-muted); }
      `}</style>
    </div>
  );
}
