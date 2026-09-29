"use client";

import { useCallback, useEffect, useState } from "react";
import { type DbConnectionMeta, type SaveMsg, friendlyError, readJson } from "./types";

const PASSWORD_HELP_HAS =
  "Kayıtlı bir parola var (görüntülenmez). Test etmek veya kaydetmek için parolayı buraya tekrar girin — mevcut sistem parolayı yeniden göndermeden test/kaydetmeyi desteklemiyor.";
const PASSWORD_HELP_NONE =
  "Parola girilmedi. Test etmek veya kaydetmek için sunucu/veritabanı/kullanıcı ile birlikte parolayı da girin.";

/**
 * B) DB Bağlantısı — server/database/user/password formu. Parola WRITE-ONLY:
 * GET asla döndürmez (yalnız `hasPassword`), bu yüzden "kullanıcı yazmazsa
 * mevcut korunur" YALNIZ görünüm (placeholder) seviyesinde geçerli — backend
 * sözleşmesi (`DbConnectionBody.password.min(1)`) hem test hem kaydet için
 * HER SEFERİNDE gerçek bir parola ister; kısmi güncelleme (yalnız
 * server/database/user değiştir, parolayı koru) bugünkü API ile mümkün
 * DEĞİL. Bunu UI'da gizlemek yerine `PASSWORD_HELP_*` metinleriyle açıkça
 * söylüyoruz — aksi halde kullanıcı "parolayı korudu" sanıp 400 alır.
 */
export function DbConnectionSection() {
  const [dbMeta, setDbMeta] = useState<DbConnectionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [server, setServer] = useState("");
  const [database, setDatabase] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<SaveMsg | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/config/db-connection", { cache: "no-store" });
      const { data, errorMessage } = await readJson<DbConnectionMeta>(res);
      if (!data) {
        setLoadError(friendlyError(new Error("empty body"), errorMessage));
        return;
      }
      setDbMeta(data);
      setServer(data.server ?? "");
      setDatabase(data.database ?? "");
      setUser(data.user ?? "");
      setPassword(""); // parola asla sunucudan gelmez — daima boş başlar
    } catch (e) {
      setLoadError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fieldsComplete = server.trim() !== "" && database.trim() !== "" && user.trim() !== "" && password !== "";

  async function test() {
    setTesting(true);
    setTestResult(null);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/config/db-connection/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: server.trim(), database: database.trim(), user: user.trim(), password }),
      });
      const { data } = await readJson<{ ok: boolean }>(res);
      setTestResult(data?.ok ? "ok" : "fail");
    } catch (e) {
      console.error("[insider-konfigurator] db-connection test", e);
      setTestResult("fail");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/admin/config/db-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ server: server.trim(), database: database.trim(), user: user.trim(), password }),
      });
      const { data, errorMessage } = await readJson<{ ok: true }>(res);
      if (!data?.ok) {
        setSaveMsg({ tone: "bad", text: friendlyError(new Error("save failed"), errorMessage) });
        return;
      }
      await load(); // server onayından sonra maskeli meta'yı yeniden çek (server/database/user + hasPassword)
      setTestResult(null);
      setSaveMsg({ tone: "good", text: "Kaydedildi ✓ — parola tekrar gösterilmez." });
    } catch (e) {
      setSaveMsg({ tone: "bad", text: friendlyError(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ik-card" aria-labelledby="ik-db-h2">
      <h2 className="ik-h2" id="ik-db-h2">E. DB Bağlantısı</h2>
      <p className="ik-sub">
        Bu ekran yalnız bağlantı bilgisini test edip şifreli olarak kaydeder;
        aktif bağlantı havuzunun bu kayıttan canlı olarak beslenmesi (hot-swap)
        kapsam dışı. Parola şifreli saklanır ve hiçbir zaman geri gösterilmez.
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
          <div className="ik-grid2" style={{ marginBottom: 14 }}>
            <label className="ik-field">
              <span className="ik-label" id="ik-db-server-label">Sunucu</span>
              <input
                id="ik-db-server"
                aria-labelledby="ik-db-server-label"
                className="ik-input"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="ör. 10.0.0.5 veya sunucu adı"
                autoComplete="off"
              />
            </label>
            <label className="ik-field">
              <span className="ik-label" id="ik-db-database-label">Veritabanı</span>
              <input
                id="ik-db-database"
                aria-labelledby="ik-db-database-label"
                className="ik-input"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="ör. PANORAMA_PROD"
                autoComplete="off"
              />
            </label>
            <label className="ik-field">
              <span className="ik-label" id="ik-db-user-label">Kullanıcı</span>
              <input
                id="ik-db-user"
                aria-labelledby="ik-db-user-label"
                className="ik-input"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="ik-field">
              <span className="ik-label" id="ik-db-password-label">Parola</span>
              <input
                id="ik-db-password"
                aria-labelledby="ik-db-password-label"
                aria-describedby="ik-db-password-help"
                className="ik-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={dbMeta?.hasPassword ? "•••• (kayıtlı)" : "girilmedi"}
                // "new-password" — tarayıcılar type=password alanlarında
                // literal autoComplete="off"'u genelde YOK SAYAR (Chromium);
                // bu admin alanının login parolasıyla karışıp otomatik
                // doldurulmasını GERÇEKTEN engelleyen değer budur.
                autoComplete="new-password"
              />
              <span id="ik-db-password-help" className="ik-help">
                {dbMeta?.hasPassword ? PASSWORD_HELP_HAS : PASSWORD_HELP_NONE}
              </span>
            </label>
          </div>

          {testResult && (
            <div role="status" style={{ marginBottom: 10 }}>
              <span className={`ik-badge ${testResult === "ok" ? "good" : "bad"}`}>
                {testResult === "ok" ? "✓ Bağlantı başarılı" : "✗ Bağlantı başarısız"}
              </span>
              {testResult === "ok" && (
                <span className="ik-help" style={{ marginLeft: 8 }}>
                  Test, az önce girdiğiniz bilgilerle yapıldı — kaydetmeden çıkarsanız bu bilgi saklanmaz.
                </span>
              )}
            </div>
          )}

          {saveMsg && (
            <div role="status" className={`ik-msg ${saveMsg.tone}`} style={{ marginBottom: 10 }}>
              {saveMsg.text}
            </div>
          )}

          <div className="ik-actions">
            <button
              type="button"
              className="ik-btn ghost"
              onClick={() => void test()}
              disabled={!fieldsComplete || testing || saving}
            >
              {testing ? "Test ediliyor…" : "Test bağlantısı"}
            </button>
            <button
              type="button"
              className="ik-btn primary"
              onClick={() => void save()}
              disabled={!fieldsComplete || saving || testing}
            >
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
