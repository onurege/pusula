"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type ActiveTenantDefinitionMeta,
  type Industry,
  type SaveMsg,
  type TenantDefinitionInput,
  type TenantLabels,
  friendlyError,
  readJson,
} from "./types";

const EMPTY_LABELS: TenantLabels = {
  morningHeadline: "",
  channelTypeTitle: "",
  channelTypeSource: "",
  mapEmptyDataSource: "",
  kpiSourceNote: "",
  volumeMultiplierHint: "",
};

/** `tenant-config-service.ts` `REQUIRED_LABEL_FIELDS` ile BİREBİR (koddan
 *  teyitli) — sıra ve alan adları orada zorunlu tutulanlarla eşleşmeli. */
const LABEL_FIELDS: { key: keyof TenantLabels; label: string; help: string }[] = [
  { key: "morningHeadline", label: "Sabah başlığı", help: "V2 giriş ekranı başlığı — \"Bu Sabah {Marka}'da Ne Oluyor\"." },
  { key: "channelTypeTitle", label: "Müşteri tipi paneli başlığı", help: "ör. \"Pernod Müşteri Tipi\" / \"Müşteri Tipi\"." },
  { key: "channelTypeSource", label: "Müşteri tipi kaynak notu", help: "Müşteri tipi panelinin altında görünen kaynak açıklaması." },
  { key: "mapEmptyDataSource", label: "Harita ilk-senkron uyarısı", help: "Harita sayfasında liste henüz senkron değilken gösterilen metin." },
  { key: "kpiSourceNote", label: "KPI kaynak notu", help: "KPI şeridindeki kaynak açıklaması." },
  { key: "volumeMultiplierHint", label: "Hacim çarpanı ipucu", help: "Hacim birimi tooltip metni (ör. 9LE)." },
];

/**
 * E. Tenant Kimliği — `packages/core/src/tenant/tenant-config-service.ts`
 * `getActiveTenantDefinitionMeta()` ile beslenir (GET parametresiz, DAİMA
 * aktif tenant — server-otoriter, bkz. o dosyanın üst yorumu #5).
 *
 * İki kökten farklı dal:
 *  - `registryManaged === true` → aktif tenant derleme-zamanı REGISTRY'de
 *    (pernod/pernod-demo/fmcg-demo/wietnauer) — bu ekrandan DÜZENLENEMEZ,
 *    yazılsa bile asla okunmaz (o id için store zaten devre dışı). Form
 *    GÖSTERİLMEZ, yalnız bilgi kutusu.
 *  - `registryManaged === false` → kodsuz (store-tabanlı) tenant — form
 *    açık. `definition === null` ise henüz hiç kaydedilmemiş (ilk kurulum,
 *    boş formla başlar); doluysa mevcut tanım önceden doldurulur.
 *
 * `id` HER ZAMAN salt-okuma — aktif tenant `process.env.TENANT`'tan gelir,
 * kullanıcı burada değiştiremez (görünür ama disabled input; POST body'sine
 * de `meta.tenantId` sabit gönderilir, kullanıcı girdisi DEĞİL).
 *
 * Optimistic update YOK — kaydet/reset sonrası yalnız GET'i tekrar çağırıp
 * (`load()`) sunucudan doğrulanmış haliyle güncellenir (`BreakdownSection`/
 * `DbConnectionSection` ile aynı disiplin).
 */
export function TenantIdentitySection() {
  const [meta, setMeta] = useState<ActiveTenantDefinitionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [industry, setIndustry] = useState<Industry | "">("");
  const [strategicBrandsText, setStrategicBrandsText] = useState("");
  const [labels, setLabels] = useState<TenantLabels>(EMPTY_LABELS);
  const [taxKey, setTaxKey] = useState("");
  const [taxLabel, setTaxLabel] = useState("");
  const [taxShowInToggle, setTaxShowInToggle] = useState(false);
  const [logoMark, setLogoMark] = useState("");

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<SaveMsg | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/config/tenant", { cache: "no-store" });
      const { data, errorMessage } = await readJson<ActiveTenantDefinitionMeta>(res);
      if (!data) {
        setLoadError(friendlyError(new Error("empty body"), errorMessage));
        return;
      }
      setMeta(data);
      if (!data.registryManaged) {
        const def = data.definition;
        setDisplayName(def?.displayName ?? "");
        setIndustry(def?.industry ?? "");
        setStrategicBrandsText(def?.strategicBrands.join(", ") ?? "");
        setLabels(def?.labels ?? EMPTY_LABELS);
        setTaxKey(def?.tax.key ?? "");
        setTaxLabel(def?.tax.label ?? "");
        setTaxShowInToggle(def?.tax.showInToggle ?? false);
        setLogoMark(def?.logoMark ?? "");
      }
    } catch (e) {
      setLoadError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const labelsComplete = LABEL_FIELDS.every(({ key }) => labels[key].trim() !== "");
  const fieldsComplete =
    displayName.trim() !== "" &&
    industry !== "" &&
    strategicBrandsText.trim() !== "" &&
    labelsComplete &&
    taxKey.trim() !== "";

  function setLabelField(key: keyof TenantLabels, value: string) {
    setLabels((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!meta || meta.registryManaged || industry === "") return;
    setSaving(true);
    setSaveMsg(null);
    setIssues(null);
    try {
      const body: TenantDefinitionInput = {
        id: meta.tenantId, // server-otoriter — kullanıcı id değiştiremez
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
      const res = await fetch("/api/admin/config/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { data, errorMessage, issues: respIssues } = await readJson<{ ok: true }>(res);
      if (!data?.ok) {
        setIssues(respIssues);
        setSaveMsg({ tone: "bad", text: friendlyError(new Error("save failed"), errorMessage) });
        return;
      }
      await load();
      setSaveMsg({ tone: "good", text: "Kaydedildi ✓ — \"Veriyi Yenile\" ile tazeleyin." });
    } catch (e) {
      setSaveMsg({ tone: "bad", text: friendlyError(e) });
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (!meta) return;
    if (!confirm("Tenant kimliği varsayılana döndürülsün mü? Kaydedilmiş tanım silinir, kod-varsayılanına dönülür."))
      return;
    setResetting(true);
    setSaveMsg(null);
    setIssues(null);
    try {
      const res = await fetch("/api/admin/config/tenant/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: meta.tenantId }),
      });
      const { data, errorMessage } = await readJson<{ ok: true }>(res);
      if (!data?.ok) {
        setSaveMsg({ tone: "bad", text: friendlyError(new Error("reset failed"), errorMessage) });
        return;
      }
      await load();
      setSaveMsg({ tone: "good", text: "Varsayılana döndürüldü ✓ — \"Veriyi Yenile\" ile tazeleyin." });
    } catch (e) {
      setSaveMsg({ tone: "bad", text: friendlyError(e) });
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="ik-card" aria-labelledby="ik-tenant-h2">
      <h2 className="ik-h2" id="ik-tenant-h2">D. Tenant Kimliği</h2>
      <p className="ik-sub">
        Aktif tenant'ın adı, stratejik markaları, UI metinleri ve vergi
        profili. Renk paleti ortaktır — burada yalnız isim/logo/metin
        düzenlenir. DB bağlantısı ayrı bölümde (E).
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

      {!loading && !loadError && meta?.registryManaged && (
        <div role="status" className="ik-current" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <span className="ik-badge neutral">Kodda tanımlı (REGISTRY)</span>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-fg-2)", lineHeight: 1.5 }}>
            Bu tenant (<code className="ik-current-src">{meta.tenantId}</code>) kodda (REGISTRY) tanımlı —
            pernod/wietnauer gibi yerleşik tenant'lar buradan düzenlenmez. Kodsuz tenant'lar bu ekrandan yönetilir.
          </p>
        </div>
      )}

      {!loading && !loadError && meta && !meta.registryManaged && (
        <>
          {meta.definition === null && (
            <p className="ik-help" style={{ marginBottom: 12 }}>
              Bu tenant için henüz bir kimlik tanımı kaydedilmedi — aşağıdaki formu doldurup Kaydet'e basarak
              oluşturabilirsin.
            </p>
          )}

          <div className="ik-grid2" style={{ marginBottom: 14 }}>
            <label className="ik-field">
              <span className="ik-label" id="ik-tenant-id-label">Tenant ID</span>
              <input
                id="ik-tenant-id"
                aria-labelledby="ik-tenant-id-label"
                aria-describedby="ik-tenant-id-help"
                className="ik-input"
                value={meta.tenantId}
                disabled
                readOnly
              />
              <span id="ik-tenant-id-help" className="ik-help">
                Aktif tenant sunucu tarafından belirlenir (ortam değişkeni) — burada değiştirilemez.
              </span>
            </label>
            <label className="ik-field">
              <span className="ik-label" id="ik-tenant-displayName-label">Görünen ad</span>
              <input
                id="ik-tenant-displayName"
                aria-labelledby="ik-tenant-displayName-label"
                className="ik-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="ör. Pernod Ricard Türkiye"
                autoComplete="off"
              />
            </label>
            <label className="ik-field">
              <span className="ik-label" id="ik-tenant-industry-label">Sektör</span>
              <select
                id="ik-tenant-industry"
                aria-labelledby="ik-tenant-industry-label"
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
              <span className="ik-label" id="ik-tenant-logoMark-label">Logo işareti (opsiyonel)</span>
              <input
                id="ik-tenant-logoMark"
                aria-labelledby="ik-tenant-logoMark-label"
                aria-describedby="ik-tenant-logoMark-help"
                className="ik-input"
                value={logoMark}
                onChange={(e) => setLogoMark(e.target.value)}
                placeholder="ör. EP"
                autoComplete="off"
              />
              <span id="ik-tenant-logoMark-help" className="ik-help">
                Boş bırakılırsa tenant ID'nin ilk 2 harfi kullanılır.
              </span>
            </label>
          </div>

          <label className="ik-field" style={{ marginBottom: 14 }}>
            <span className="ik-label" id="ik-tenant-brands-label">Stratejik markalar</span>
            <input
              id="ik-tenant-brands"
              aria-labelledby="ik-tenant-brands-label"
              aria-describedby="ik-tenant-brands-help"
              className="ik-input"
              value={strategicBrandsText}
              onChange={(e) => setStrategicBrandsText(e.target.value)}
              placeholder="Marka A, Marka B, Marka C"
              autoComplete="off"
            />
            <span id="ik-tenant-brands-help" className="ik-help">
              Virgülle ayır — en az 1 marka zorunlu.
            </span>
          </label>

          <fieldset style={{ border: "none", padding: 0, margin: "0 0 14px" }}>
            <legend className="ik-label" style={{ marginBottom: 8 }}>UI metinleri (labels) — tümü zorunlu</legend>
            <div className="ik-grid2">
              {LABEL_FIELDS.map(({ key, label, help }) => (
                <label className="ik-field" key={key}>
                  <span className="ik-label" id={`ik-tenant-label-${key}-label`}>{label}</span>
                  <input
                    id={`ik-tenant-label-${key}`}
                    aria-labelledby={`ik-tenant-label-${key}-label`}
                    aria-describedby={`ik-tenant-label-${key}-help`}
                    className="ik-input"
                    value={labels[key]}
                    onChange={(e) => setLabelField(key, e.target.value)}
                    autoComplete="off"
                  />
                  <span id={`ik-tenant-label-${key}-help`} className="ik-help">{help}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: "none", padding: 0, margin: "0 0 14px" }}>
            <legend className="ik-label" style={{ marginBottom: 8 }}>Vergi profili</legend>
            <div className="ik-grid2">
              <label className="ik-field">
                <span className="ik-label" id="ik-tenant-tax-key-label">Vergi anahtarı (tax.key)</span>
                <input
                  id="ik-tenant-tax-key"
                  aria-labelledby="ik-tenant-tax-key-label"
                  className="ik-input"
                  value={taxKey}
                  onChange={(e) => setTaxKey(e.target.value)}
                  placeholder="ör. otv-net"
                  autoComplete="off"
                />
              </label>
              <label className="ik-field">
                <span className="ik-label" id="ik-tenant-tax-label-label">Vergi etiketi (tax.label)</span>
                <input
                  id="ik-tenant-tax-label"
                  aria-labelledby="ik-tenant-tax-label-label"
                  aria-describedby="ik-tenant-tax-label-help"
                  className="ik-input"
                  value={taxLabel}
                  onChange={(e) => setTaxLabel(e.target.value)}
                  placeholder="ör. OTV net (opsiyonel — boş bırakılabilir)"
                  autoComplete="off"
                />
                <span id="ik-tenant-tax-label-help" className="ik-help">
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

          {saveMsg && !issues && (
            <div role="status" className={`ik-msg ${saveMsg.tone}`} style={{ marginBottom: 10 }}>
              {saveMsg.text}
            </div>
          )}

          <div className="ik-actions">
            <button
              type="button"
              className="ik-btn ghost ik-actions-left"
              onClick={() => void resetToDefault()}
              disabled={resetting || saving}
            >
              {resetting ? "Sıfırlanıyor…" : "Varsayılana dön"}
            </button>
            <button
              type="button"
              className="ik-btn primary"
              onClick={() => void save()}
              disabled={!fieldsComplete || saving || resetting}
            >
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
