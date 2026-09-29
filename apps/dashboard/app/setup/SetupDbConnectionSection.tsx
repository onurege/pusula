"use client";

import { useState } from "react";
import Link from "next/link";
import { SETUP_TOKEN_HEADER, readSetupResponse, setupGenericError, type SetupMsg } from "./types";

/**
 * Adım 1 — DB Bağlantısı. `app/admin/konfigurator/DbConnectionSection.tsx`
 * ile AYNI form deseni (server/database/user/password, parola WRITE-ONLY,
 * test → kaydet). FARKI: burada bir GET/`load()` YOK — setup uçlarında
 * "mevcut değeri getir" ucu yok (bkz. `apps/api/src/server.ts` setup bloğu:
 * yalnız üç POST), bu ekran her zaman BOŞ formla başlar (ilk kurulum).
 *
 * Her istek `token` prop'unu `x-setup-token` header'ında taşır — token
 * gövdeye/URL'e ASLA karışmaz (bkz. `app/setup/page.tsx` üst yorumu).
 */
export function SetupDbConnectionSection({
  token,
  onSaved,
}: {
  token: string;
  onSaved: () => void;
}) {
  const [server, setServer] = useState("");
  const [database, setDatabase] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SetupMsg | null>(null);
  const [saved, setSaved] = useState(false);

  const fieldsComplete =
    token.trim() !== "" &&
    server.trim() !== "" &&
    database.trim() !== "" &&
    user.trim() !== "" &&
    password !== "";

  async function test() {
    setTesting(true);
    setTestResult(null);
    setMsg(null);
    try {
      const res = await fetch("/api/setup/db-connection/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", [SETUP_TOKEN_HEADER]: token },
        body: JSON.stringify({ server: server.trim(), database: database.trim(), user: user.trim(), password }),
      });
      const { data, msg: errMsg } = await readSetupResponse<{ ok: boolean }>(res);
      if (errMsg) {
        setMsg(errMsg);
        return;
      }
      setTestResult(data?.ok ? "ok" : "fail");
    } catch (e) {
      setMsg(setupGenericError(e));
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/setup/db-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json", [SETUP_TOKEN_HEADER]: token },
        body: JSON.stringify({ server: server.trim(), database: database.trim(), user: user.trim(), password }),
      });
      const { data, msg: errMsg } = await readSetupResponse<{ ok: true }>(res);
      if (errMsg) {
        setMsg(errMsg);
        return;
      }
      if (!data?.ok) {
        setMsg({ tone: "bad", text: "Kaydedilemedi." });
        return;
      }
      setPassword(""); // parola bir daha ekranda görünmesin
      setTestResult(null);
      setSaved(true);
      setMsg({ tone: "good", text: "DB bağlantısı kaydedildi ✓" });
      onSaved();
    } catch (e) {
      setMsg(setupGenericError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ik-card" aria-labelledby="su-db-h2">
      <h2 className="ik-h2" id="su-db-h2">
        Adım 1 — DB Bağlantısı
        {saved && <span className="ik-badge good">Kaydedildi</span>}
      </h2>
      <p className="ik-sub">
        MSSQL sunucu/veritabanı/kullanıcı/parola. Önce test edin, sonra kaydedin — parola şifreli saklanır ve
        bir daha geri gösterilmez.
      </p>

      <div className="ik-grid2" style={{ marginBottom: 14 }}>
        <label className="ik-field">
          <span className="ik-label" id="su-db-server-label">Sunucu</span>
          <input
            id="su-db-server"
            aria-labelledby="su-db-server-label"
            className="ik-input"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="ör. 10.0.0.5 veya sunucu adı"
            autoComplete="off"
          />
        </label>
        <label className="ik-field">
          <span className="ik-label" id="su-db-database-label">Veritabanı</span>
          <input
            id="su-db-database"
            aria-labelledby="su-db-database-label"
            className="ik-input"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="ör. PANORAMA_PROD"
            autoComplete="off"
          />
        </label>
        <label className="ik-field">
          <span className="ik-label" id="su-db-user-label">Kullanıcı</span>
          <input
            id="su-db-user"
            aria-labelledby="su-db-user-label"
            className="ik-input"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="ik-field">
          <span className="ik-label" id="su-db-password-label">Parola</span>
          <input
            id="su-db-password"
            aria-labelledby="su-db-password-label"
            className="ik-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // "new-password" — type=password alanlarında literal
            // autoComplete="off"'u Chromium genelde YOK SAYAR; bu admin
            // alanının kullanıcının kendi login parolasıyla otomatik
            // doldurulmasını GERÇEKTEN engelleyen değer budur.
            autoComplete="new-password"
          />
        </label>
      </div>

      {testResult && (
        <div role="status" style={{ marginBottom: 10 }}>
          <span className={`ik-badge ${testResult === "ok" ? "good" : "bad"}`}>
            {testResult === "ok" ? "✓ Bağlantı başarılı" : "✗ Bağlantı başarısız"}
          </span>
        </div>
      )}

      {msg && (
        <div
          role={msg.tone === "bad" ? "alert" : "status"}
          className={`ik-msg ${msg.tone}`}
          style={{ marginBottom: 10 }}
        >
          {msg.text}
          {msg.loginLink && (
            <>
              {" "}
              <Link href="/login" className="ik-link">Giriş sayfasına git</Link>
            </>
          )}
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
    </section>
  );
}
