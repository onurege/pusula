"use client";

import { useState } from "react";
import Link from "next/link";
import {
  SETUP_TOKEN_HEADER,
  readSetupResponse,
  setupGenericError,
  type Industry,
  type SetupMsg,
  type SetupTenantDefinitionInput,
  type SetupTenantSavedConfig,
  type TenantLabels,
} from "./types";

const EMPTY_LABELS: TenantLabels = {
  morningHeadline: "",
  channelTypeTitle: "",
  channelTypeSource: "",
  mapEmptyDataSource: "",
  kpiSourceNote: "",
  volumeMultiplierHint: "",
};

/** `tenant-config-service.ts` `REQUIRED_LABEL_FIELDS` ile BİREBİR — bkz.
 *  `app/admin/konfigurator/TenantIdentitySection.tsx` üst yorumu (AYNI
 *  sözleşme, bu ekran onun kurulum-öncesi versiyonu). */
const LABEL_FIELDS: { key: keyof TenantLabels; label: string; help: string }[] = [
  { key: "morningHeadline", label: "Sabah başlığı", help: "V2 giriş ekranı başlığı — \"Bu Sabah {Marka}'da Ne Oluyor\"." },
  { key: "channelTypeTitle", label: "Müşteri tipi paneli başlığı", help: "ör. \"Müşteri Tipi\"." },
  { key: "channelTypeSource", label: "Müşteri tipi kaynak notu", help: "Müşteri tipi panelinin altında görünen kaynak açıklaması." },
  { key: "mapEmptyDataSource", label: "Harita ilk-senkron uyarısı", help: "Harita sayfasında liste henüz senkron değilken gösterilen metin." },
  { key: "kpiSourceNote", label: "KPI kaynak notu", help: "KPI şeridindeki kaynak açıklaması." },
  { key: "volumeMultiplierHint", label: "Hacim çarpanı ipucu", help: "Hacim birimi tooltip metni (ör. 9LE)." },
];

/**
 * Adım 2 — Tenant Kimliği. `TenantIdentitySection.tsx`'in kurulum-öncesi
 * versiyonu. FARKI: `id` alanı YOK — server `resolveActiveTenantId()`
 * (`process.env.TENANT`) kullanır, bu ekranda "hangi tenant" hiç sorulmaz;
 * `registryManaged`/reset akışı da YOK (setup modu zaten yalnız kodsuz/
 * store-tabanlı tenant'larda aktif olur — REGISTRY-yönetimli tenant'lar
 * için `isActiveTenantIncomplete()` hep `false`, setup hiç açılmaz).
 *
 * Kayıt başarılı olunca sunucunun ATADIĞI gerçek id, yanıttaki `config.id`
 * alanından okunup kullanıcıya gösterilir (kullanıcı hiçbir yerde id
 * girmedi — server-otoriter, Faz 0 şart #3).
 */
export function SetupTenantIdentitySection({
  token,
  onSaved,
}: {
  token: string;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [industry, setIndustry] = useState<Industry | "">("");
  const [strategicBrandsText, setStrategicBrandsText] = useState("");
  const [labels, setLabels] = useState<TenantLabels>(EMPTY_LABELS);
  const [taxKey, setTaxKey] = useState("");
  const [taxLabel, setTaxLabel] = useState("");
  const [taxShowInToggle, setTaxShowInToggle] = useState(false);
  const [logoMark, setLogoMark] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SetupMsg | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const labelsComplete = LABEL_FIELDS.every(({ key }) => labels[key].trim() !== "");
  const fieldsComplete =
    token.trim() !== "" &&
    displayName.trim() !== "" &&
    industry !== "" &&
    strategicBrandsText.trim() !== "" &&
    labelsComplete &&
    taxKey.trim() !== "";

  function setLabelField(key: keyof TenantLabels, value: string) {
    setLabels((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (industry === "") return;
    setSaving(true);
    setMsg(null);
    setIssues(null);
    try {
      const body: SetupTenantDefinitionInput = {
        displayName: displayName.trim(),
        industry,
        strategicBrands: strategicBrandsText
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== ""),
        labels,
        tax: { key: taxKey.trim(), label: taxLabel, showInToggle: taxShowInToggle },
        ...(logoMark.trim() !== "" ? { logoMark: logoMark.trim() } : {}),
      };
      const res = await fetch("/api/setup/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json", [SETUP_TOKEN_HEADER]: token },
        body: JSON.stringify(body),
      });
      const { data, msg: errMsg, issues: respIssues } = await readSetupResponse<{
        ok: true;
        config: SetupTenantSavedConfig;
      }>(res);
      if (errMsg) {
        setIssues(respIssues);
        setMsg(errMsg);
        return;
      }
      if (!data?.ok) {
        setMsg({ tone: "bad", text: "Kaydedilemedi." });
        return;
      }
      setSavedId(data.config.id);
      setMsg({ tone: "good", text: `Kaydedildi ✓ — tenant id: ${data.config.id}` });
      onSaved();
    } catch (e) {
      setMsg(setupGenericError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ik-card" aria-labelledby="su-tenant-h2">
      <h2 className="ik-h2" id="su-tenant-h2">
        Adım 2 — Tenant Kimliği
        {savedId && <span className="ik-badge good">Kaydedildi</span>}
      </h2>
      <p className="ik-sub">
        Bu sunucudaki tenant ID sunucu tarafından ortam değişkeninden (<code>TENANT</code>) belirlenir — burada
        girilmez. Aşağıdaki alanlar yalnız görünen ad/marka/metin kimliğidir.
      </p>

      <div className="ik-grid2" style={{ marginBottom: 14 }}>
        <label className="ik-field">
          <span className="ik-label" id="su-tenant-displayName-label">Görünen ad</span>
          <input
            id="su-tenant-displayName"
            aria-labelledby="su-tenant-displayName-label"
            className="ik-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="ör. Örnek Ticaret A.Ş."
            autoComplete="off"
          />
        </label>
        <label className="ik-field">
          <span className="ik-label" id="su-tenant-industry-label">Sektör</span>
          <select
            id="su-tenant-industry"
            aria-labelledby="su-tenant-industry-label"
            className="ik-input"
            value={industry}
            onChange={(e) => setIndustry(e.target.value as Industry)}
          >
            <option value="">Seçin…</option>
            <option value="alcohol">Alkol</option>
            <option value="fmcg">FMCG</option>
          </select>
        </label>
        <label className="ik-field">
          <span className="ik-label" id="su-tenant-logoMark-label">Logo işareti (opsiyonel)</span>
          <input
            id="su-tenant-logoMark"
            aria-labelledby="su-tenant-logoMark-label"
            aria-describedby="su-tenant-logoMark-help"
            className="ik-input"
            value={logoMark}
            onChange={(e) => setLogoMark(e.target.value)}
            placeholder="ör. EP"
            autoComplete="off"
          />
          <span id="su-tenant-logoMark-help" className="ik-help">
            Boş bırakılırsa tenant ID'nin ilk 2 harfi kullanılır.
          </span>
        </label>
      </div>

      <label className="ik-field" style={{ marginBottom: 14 }}>
        <span className="ik-label" id="su-tenant-brands-label">Stratejik markalar</span>
        <input
          id="su-tenant-brands"
          aria-labelledby="su-tenant-brands-label"
          aria-describedby="su-tenant-brands-help"
          className="ik-input"
          value={strategicBrandsText}
          onChange={(e) => setStrategicBrandsText(e.target.value)}
          placeholder="Marka A, Marka B, Marka C"
          autoComplete="off"
        />
        <span id="su-tenant-brands-help" className="ik-help">
          Virgülle ayır — en az 1 marka zorunlu.
        </span>
      </label>

      <fieldset style={{ border: "none", padding: 0, margin: "0 0 14px" }}>
        <legend className="ik-label" style={{ marginBottom: 8 }}>UI metinleri (labels) — tümü zorunlu</legend>
        <div className="ik-grid2">
          {LABEL_FIELDS.map(({ key, label, help }) => (
            <label className="ik-field" key={key}>
              <span className="ik-label" id={`su-tenant-label-${key}-label`}>{label}</span>
              <input
                id={`su-tenant-label-${key}`}
                aria-labelledby={`su-tenant-label-${key}-label`}
                aria-describedby={`su-tenant-label-${key}-help`}
                className="ik-input"
                value={labels[key]}
                onChange={(e) => setLabelField(key, e.target.value)}
                autoComplete="off"
              />
              <span id={`su-tenant-label-${key}-help`} className="ik-help">{help}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: "none", padding: 0, margin: "0 0 14px" }}>
        <legend className="ik-label" style={{ marginBottom: 8 }}>Vergi profili</legend>
        <div className="ik-grid2">
          <label className="ik-field">
            <span className="ik-label" id="su-tenant-tax-key-label">Vergi anahtarı (tax.key)</span>
            <input
              id="su-tenant-tax-key"
              aria-labelledby="su-tenant-tax-key-label"
              className="ik-input"
              value={taxKey}
              onChange={(e) => setTaxKey(e.target.value)}
              placeholder="ör. otv-net"
              autoComplete="off"
            />
          </label>
          <label className="ik-field">
            <span className="ik-label" id="su-tenant-tax-label-label">Vergi etiketi (tax.label)</span>
            <input
              id="su-tenant-tax-label"
              aria-labelledby="su-tenant-tax-label-label"
              aria-describedby="su-tenant-tax-label-help"
              className="ik-input"
              value={taxLabel}
              onChange={(e) => setTaxLabel(e.target.value)}
              placeholder="ör. OTV net (opsiyonel — boş bırakılabilir)"
              autoComplete="off"
            />
            <span id="su-tenant-tax-label-help" className="ik-help">
              Alkolde ÖTV, FMCG'de genelde boş — toggle'da görünen metin.
            </span>
          </label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: "var(--color-fg-2)" }}>
          <input
            type="checkbox"
            checked={taxShowInToggle}
            onChange={(e) => setTaxShowInToggle(e.target.checked)}
          />
          Vergi toggle'ı dashboard'da göster (showInToggle)
        </label>
      </fieldset>

      {issues && issues.length > 0 && (
        <div role="alert" className="ik-msg bad" style={{ marginBottom: 10 }}>
          <div style={{ marginBottom: 4 }}>Kaydedilemedi — aşağıdaki alanları düzelt:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {msg && !issues && (
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
          className="ik-btn primary"
          onClick={() => void save()}
          disabled={!fieldsComplete || saving}
        >
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
    </section>
  );
}
