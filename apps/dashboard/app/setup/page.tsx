"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SetupDbConnectionSection } from "./SetupDbConnectionSection";
import { SetupTenantIdentitySection } from "./SetupTenantIdentitySection";

/**
 * `/setup` — boş sunucuda ekrandan kurulum (Faz A Dalga 2). Kök layout
 * (`app/layout.tsx`) yalnız aktif tenant TAMAMEN TANIMSIZKEN buraya erişim
 * verir/yönlendirir (`isTenantFullyMissing()`) — bu sayfanın kendisi bunu
 * ÖNCEDEN bilmiyor (setup uçlarında bir "durum" GET'i yok, bkz. `types.ts`
 * üst yorumu), yalnız test/kaydet denemelerinin 404 dönmesiyle öğrenir.
 *
 * Bilinen sınır: "tamamlandı" bandı yalnız BU SAYFA OTURUMUNDA tutulan
 * `dbSaved`/`tenantSaved` client state'ine dayanır — sayfa yenilenirse
 * (F5) form yeniden boş görünür, backend'de kayıt DURUYOR olsa bile
 * (setup uçlarında "zaten kaydedilmiş mi" diye bakacak bir GET yok). Zararı
 * yok — tekrar kaydetmek aynı veriyi yazar; ama UX'i bilerek dürüst tutuyoruz.
 *
 * Token akışı: `token` state'i BU sayfada tutulur, iki alt bölüme salt-okunur
 * prop olarak geçer — hiçbir yerde (URL/localStorage/cookie) SAKLANMAZ,
 * yalnız istek header'ında (`x-setup-token`, `app/api/setup/[...path]/
 * route.ts` bunu olduğu gibi backend'e taşır) gider. Her iki adım da
 * kaydedilince token OTOMATİK temizlenir (artık gerekmiyor — hassas veriyi
 * bellekte gereğinden uzun tutmamak için); kullanıcı isterse "Temizle" ile
 * de manuel silebilir.
 *
 * Adım sırası (1: DB, 2: Kimlik) yalnız GÖRSEL rehberlik — backend hangi
 * sırada kaydedildiğini önemsemiyor (`isActiveTenantIncomplete()` ikisinin
 * de VAR olup olmadığına bakar, sıraya değil) — bu yüzden burada bilerek
 * birbirini KİLİTLEMİYORLAR (Step 2, Step 1 tamamlanmadan da doldurulabilir).
 */
export default function SetupPage() {
  const [token, setToken] = useState("");
  const [dbSaved, setDbSaved] = useState(false);
  const [tenantSaved, setTenantSaved] = useState(false);

  const completed = dbSaved && tenantSaved;

  useEffect(() => {
    if (completed) setToken("");
  }, [completed]);

  return (
    <div className="v3-page" style={{ padding: "24px 0 32px", maxWidth: 900, margin: "0 auto" }}>
      <header style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--color-border)" }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--color-accent)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          İlk Kurulum
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 600,
            color: "var(--color-fg)",
            letterSpacing: "-0.025em",
            margin: "4px 0 6px",
          }}
        >
          Insider Kurulumu
        </h1>
        <p style={{ fontSize: 13.5, color: "var(--color-muted)", margin: 0, maxWidth: 640 }}>
          Bu sunucuda henüz aktif bir tenant tanımı yok. Aşağıdaki iki adımı tamamlayınca giriş yapabilirsiniz.
        </p>
      </header>

      {completed ? (
        <div role="status" className="ik-current" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <span className="ik-badge good">Kurulum tamam</span>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-fg-2)" }}>
            DB bağlantısı ve tenant kimliği kaydedildi. Şimdi giriş yapabilirsiniz.
          </p>
          <Link href="/login" className="ik-btn primary" style={{ textDecoration: "none", display: "inline-block" }}>
            Giriş yap
          </Link>
        </div>
      ) : (
        <>
          <section className="ik-card" aria-labelledby="su-token-h2">
            <h2 className="ik-h2" id="su-token-h2">Kurulum Token'ı</h2>
            <p className="ik-sub">
              Sunucu ortamındaki <code>SETUP_TOKEN</code> değeri. Yalnız istek başlığında (header) gönderilir —
              hiçbir zaman adres çubuğuna, log'a veya tarayıcı depolamasına (localStorage) yazılmaz.
            </p>
            <label className="ik-field">
              <span className="ik-label" id="su-token-label">SETUP_TOKEN</span>
              <input
                id="su-token"
                aria-labelledby="su-token-label"
                aria-describedby="su-token-help"
                className="ik-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Sunucu ortam değişkenindeki değer"
                autoComplete="off"
              />
              <span id="su-token-help" className="ik-help">
                Adım 1 ve Adım 2'deki tüm test/kaydet istekleri bu değeri header'da taşır.
              </span>
            </label>
            {token !== "" && (
              <div className="ik-actions" style={{ marginTop: 10 }}>
                <button type="button" className="ik-btn ghost" onClick={() => setToken("")}>
                  Temizle
                </button>
              </div>
            )}
          </section>

          <SetupDbConnectionSection token={token} onSaved={() => setDbSaved(true)} />
          <SetupTenantIdentitySection token={token} onSaved={() => setTenantSaved(true)} />
        </>
      )}

      <style jsx global>{`
        .ik-link { font-size: 12.5px; color: var(--color-accent); }
        .ik-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
        .ik-h2 { font-size: 15px; font-weight: 600; color: var(--color-fg); margin: 0 0 4px; display: flex; align-items: center; gap: 8px; }
        .ik-sub { font-size: 12.5px; color: var(--color-muted); margin: 0 0 14px; max-width: 640px; line-height: 1.5; }
        .ik-field { display: flex; flex-direction: column; gap: 4px; }
        .ik-label { font-size: 12px; font-weight: 500; color: var(--color-fg-2); }
        .ik-input { width: 100%; box-sizing: border-box; padding: 8px 11px; font-size: 13px; color: var(--color-fg); font-family: inherit; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 7px; }
        .ik-input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
        .ik-input:disabled { opacity: .6; cursor: not-allowed; }
        .ik-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
        .ik-btn.primary { background: var(--color-accent); color: var(--color-accent-fg); }
        .ik-btn.ghost { background: transparent; color: var(--color-muted); border-color: var(--color-border); }
        .ik-btn:disabled { opacity: .5; cursor: not-allowed; }
        .ik-btn:focus-visible, .ik-input:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
        .ik-msg { font-size: 12.5px; font-weight: 500; }
        .ik-msg.good { color: var(--color-good); }
        .ik-msg.bad { color: var(--color-bad); }
        .ik-badge { font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px; }
        .ik-badge.good { color: var(--color-good); background: var(--color-good-soft); }
        .ik-badge.bad { color: var(--color-bad); background: var(--color-bad-soft); }
        .ik-current { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 16px; border: 1px solid var(--color-border); border-radius: 9px; background: var(--color-surface-2); margin-bottom: 16px; }
        .ik-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
        .ik-grid2 { display: grid; grid-template-columns: 1fr; gap: 14px; }
        @media (min-width: 720px) { .ik-grid2 { grid-template-columns: 1fr 1fr; } }
        .ik-help { font-size: 11.5px; color: var(--color-muted); margin-top: 4px; line-height: 1.4; }
      `}</style>
    </div>
  );
}
