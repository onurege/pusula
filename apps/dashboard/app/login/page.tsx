"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";
import { useTenant } from "@/components/tenant-provider";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Çok-DB kurulumunda (Panorama "şirket" seçicisi karşılığı) login'de seçilen
  // veritabanı. Liste boşsa (tek-DB tenant) dropdown gizlenir ve `dbId`
  // gönderilmez → backend bugünkü tek-DB yolunu izler.
  const [databases, setDatabases] = useState<Array<{ id: string; label: string }>>([]);
  const [dbId, setDbId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenant = useTenant();

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/databases", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list = Array.isArray(d?.databases) ? d.databases : [];
        setDatabases(list);
        if (list.length > 0) setDbId(list[0].id);
      })
      .catch(() => {
        /* yok say — dropdown gizli kalır, tek-DB gibi davranır */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    if (databases.length > 0 && !dbId) return;
    setLoading(true);
    setError(null);
    const err = await login(username, password, databases.length > 0 ? dbId : undefined);
    if (err) {
      setError(err);
      setLoading(false);
    } else {
      const next = searchParams?.get("next");
      const fallback = tenant.ui?.defaultLanding ?? "/";
      router.push(next && next.startsWith("/") ? next : fallback);
      router.refresh();
    }
  }

  const brand = tenant?.displayName ?? "Insider";

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-badge">{(brand[0] ?? "E").toUpperCase()}</div>
        <h1 className="login-title">{brand}</h1>
        <p className="login-sub">Hesabınıza giriş yapın</p>

        <label className="login-label" htmlFor="username">Kullanıcı Adı</label>
        <input
          id="username"
          className="login-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Kullanıcı adınız"
          autoComplete="username"
          autoFocus
        />

        <label className="login-label" htmlFor="password">Şifre</label>
        <input
          id="password"
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Şifreniz"
          autoComplete="current-password"
        />

        {databases.length > 0 && (
          <>
            <label className="login-label" htmlFor="dbId">Veritabanı</label>
            <select
              id="dbId"
              className="login-input"
              value={dbId}
              onChange={(e) => setDbId(e.target.value)}
            >
              {databases.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </>
        )}

        {error && <p className="login-error">{error}</p>}

        <button
          className="login-btn"
          type="submit"
          disabled={loading || !username.trim() || !password.trim() || (databases.length > 0 && !dbId)}
        >
          {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
        </button>
      </form>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .login-wrap { min-height: 70dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
        .login-card {
          width: 100%; max-width: 360px;
          display: flex; flex-direction: column;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 14px;
          padding: 32px 28px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.06);
        }
        .login-badge {
          width: 52px; height: 52px; border-radius: 14px;
          background: var(--color-accent); color: var(--color-accent-fg, #fff);
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; font-weight: 700; margin: 0 auto 16px;
        }
        .login-title { font-size: 20px; font-weight: 700; text-align: center; color: var(--color-fg); letter-spacing: -0.01em; }
        .login-sub { font-size: 13px; color: var(--color-muted); text-align: center; margin: 4px 0 22px; }
        .login-label { font-size: 12px; font-weight: 600; color: var(--color-fg); margin-bottom: 6px; }
        .login-input {
          width: 100%; box-sizing: border-box;
          padding: 10px 12px; margin-bottom: 16px;
          font-size: 14px; color: var(--color-fg);
          background: var(--color-bg, var(--color-surface));
          border: 1px solid var(--color-border); border-radius: 8px;
          font-family: inherit;
        }
        .login-input:focus { outline: 2px solid var(--color-accent); outline-offset: 1px; border-color: transparent; }
        .login-error { font-size: 13px; color: var(--color-bad, #dc2626); margin: 0 0 14px; }
        .login-btn {
          width: 100%; padding: 11px 16px;
          font-size: 14px; font-weight: 600;
          color: var(--color-accent-fg, #fff); background: var(--color-accent);
          border: none; border-radius: 8px; cursor: pointer;
          transition: opacity 0.15s;
        }
        .login-btn:hover:not(:disabled) { opacity: 0.9; }
        .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `,
        }}
      />
    </div>
  );
}
