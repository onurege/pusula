"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type BreakdownConfigResponse,
  type Candidate,
  type PreviewResponse,
  type SaveMsg,
  friendlyError,
  matchRateTone,
  readJson,
} from "./types";

/**
 * Boyut-parametreli kırılım bölümü — 3. tekrarda (müşteri → ürün → bölge)
 * kopyadan tek bileşene çıkarıldı (Faz B Dalga 2). `customer-breakdown`,
 * `product-breakdown`, `region-breakdown` servisleri BİREBİR aynı response
 * şeklini döner (`packages/core/src/tenant/{customer,product,region}
 * -breakdown-config-service.ts` — koddan teyit edildi), bu yüzden tek generic
 * bileşen + boyut başına `BreakdownDimensionConfig` yeterli.
 *
 * Üç davranış BURADA, TEK YERDE korunuyor (üç boyut da miras alır):
 *  1) Yüklenince, kullanıcı henüz seçim yapmadıysa aktif kaynağın önizlemesi
 *     otomatik gösterilir (aktif aday da örnek değer + eşleşme oranıyla görünür).
 *  2) Aktif kart tıklanabilir (disabled değil) — kendi önizlemesini yeniden çeker.
 *  3) Seçili aday zaten aktif kaynaksa "Kaydet" kapanır ("Zaten aktif").
 *
 * Optimistic update YOK: kaydet/reset sonrası "aktif kaynak" yalnızca GET'i
 * tekrar çağırıp (`load()`) sunucudan doğrulanmış haliyle güncellenir.
 */
export type BreakdownDimensionConfig = {
  /** aria-labelledby kökü + React key namespace — örn. "product-breakdown". */
  sectionId: string;
  /** `/api/admin/config/<endpointBase>` — GET/POST; `/preview`, `/reset` ekleri sabit. */
  endpointBase: "customer-breakdown" | "product-breakdown" | "region-breakdown";
  /** Bölüm başlığı — örn. "B. Ürün Kırılımı Eşlemesi". */
  title: string;
  /** Başlık altı açıklama paragrafı. */
  subtitle: string;
  /** "Aktif kaynak" rozetinin altında, bu kırılımın nerede kullanıldığını
   *  açıklayan kısa yardımcı metin (opsiyonel — boyuta özgü bağlam). */
  currentSourceHint?: string;
  /** Varsayılana dönüş onay diyalogu metni (boyut adı geçmeli, Türkçe dilbilgisi
   *  boyuttan boyuta değiştiği için tek şablondan üretilmiyor). */
  resetConfirmText: string;
  /** Eşleşme oranındaki payda neyi sayıyor — müşteri kırılımında "aktif
   *  müşteri" (TBLMUSTERI), üründe "aktif ürün" (TBLURUN), bölgede "aktif
   *  dağıtım kaydı" (TBLDIST). Servis katmanındaki `computeMatchRate`
   *  çağrısının `parentTable`/`activeFilter` argümanıyla BİREBİR eşleşmeli —
   *  bkz. `packages/core/src/tenant/{product,region}-breakdown-config-service.ts`. */
  parentEntityLabel: string;
};

export function BreakdownSection({ config }: { config: BreakdownDimensionConfig }) {
  const { sectionId, endpointBase, title, subtitle, currentSourceHint, resetConfirmText, parentEntityLabel } = config;
  const headingId = `ik-${sectionId}-h2`;

  const [meta, setMeta] = useState<BreakdownConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<SaveMsg | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/config/${endpointBase}`, { cache: "no-store" });
      const { data, errorMessage } = await readJson<BreakdownConfigResponse>(res);
      if (!data) {
        setLoadError(friendlyError(new Error("empty body"), errorMessage));
        return;
      }
      setMeta(data);
    } catch (e) {
      setLoadError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [endpointBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const current = meta?.current ?? null;
  const currentCandidate = current
    ? (meta?.candidates.find(
        (c) => c.table === current.table && c.joinColumn === current.joinColumn && c.labelColumn === current.labelColumn,
      ) ?? null)
    : null;

  const selectCandidate = useCallback(
    async (candidate: Candidate) => {
      setSelectedId(candidate.id);
      setPreview(null);
      setPreviewError(null);
      setSaveMsg(null);
      setPreviewLoading(true);
      try {
        const res = await fetch(`/api/admin/config/${endpointBase}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            table: candidate.table,
            joinColumn: candidate.joinColumn,
            labelColumn: candidate.labelColumn,
            sampleLimit: 10,
          }),
        });
        const { data, errorMessage } = await readJson<PreviewResponse>(res);
        if (!data) {
          setPreviewError(friendlyError(new Error("preview failed"), errorMessage));
          return;
        }
        setPreview(data);
      } catch (e) {
        setPreviewError(friendlyError(e));
      } finally {
        setPreviewLoading(false);
      }
    },
    [endpointBase],
  );

  // Yüklendikten sonra, kullanıcı henüz bir seçim yapmadıysa aktif kaynağın
  // önizlemesini otomatik göster — aktif kırılımın da örnek değer + eşleşme
  // oranı görünsün (yalnız alternatifler değil).
  useEffect(() => {
    if (meta && currentCandidate && selectedId === null) {
      void selectCandidate(currentCandidate);
    }
    // selectCandidate/currentCandidate meta'dan türer; yalnız meta değişince tetikle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const selectedCandidate = meta?.candidates.find((c) => c.id === selectedId) ?? null;
  const savable = !!preview && preview.sampleValues !== null && preview.matchRate !== null;
  // Seçili aday zaten aktif kaynaksa kaydetmek gereksiz (aynı eşlemeyi override
  // olarak yazmasın) — Kaydet kapalı, önizleme yine görünür.
  const selectedIsActive =
    !!selectedCandidate &&
    !!current &&
    selectedCandidate.table === current.table &&
    selectedCandidate.joinColumn === current.joinColumn &&
    selectedCandidate.labelColumn === current.labelColumn;

  async function save() {
    if (!selectedCandidate) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/config/${endpointBase}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: selectedCandidate.table,
          joinColumn: selectedCandidate.joinColumn,
          labelColumn: selectedCandidate.labelColumn,
        }),
      });
      const { data, errorMessage } = await readJson<{ ok: true }>(res);
      if (!data?.ok) {
        setSaveMsg({ tone: "bad", text: friendlyError(new Error("save failed"), errorMessage) });
        return;
      }
      await load();
      setSelectedId(null);
      setPreview(null);
      setSaveMsg({
        tone: "good",
        text: "Kaydedildi ✓ — dashboard'daki mevcut görünümler eski kırılımı gösterebilir; \"Veriyi Yenile\" ile tazeleyin.",
      });
    } catch (e) {
      setSaveMsg({ tone: "bad", text: friendlyError(e) });
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (!confirm(resetConfirmText)) return;
    setResetting(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/config/${endpointBase}/reset`, { method: "POST" });
      const { data, errorMessage } = await readJson<{ ok: true }>(res);
      if (!data?.ok) {
        setSaveMsg({ tone: "bad", text: friendlyError(new Error("reset failed"), errorMessage) });
        return;
      }
      await load();
      setSelectedId(null);
      setPreview(null);
      setSaveMsg({ tone: "good", text: "Varsayılana döndürüldü ✓ — \"Veriyi Yenile\" ile tazeleyin." });
    } catch (e) {
      setSaveMsg({ tone: "bad", text: friendlyError(e) });
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="ik-card" aria-labelledby={headingId}>
      <h2 className="ik-h2" id={headingId}>{title}</h2>
      <p className="ik-sub">{subtitle}</p>

      {loading && <LoadingSkeleton />}

      {!loading && loadError && <LoadErrorBanner message={loadError} onRetry={() => void load()} />}

      {!loading && !loadError && current && (
        <>
          <CurrentSourceBadge current={current} displayName={currentCandidate?.displayName ?? null} hint={currentSourceHint} />

          {meta && meta.candidates.length === 0 && <p className="ik-muted">Küratörlü aday bulunamadı.</p>}

          <div className="ik-cand-list" role="list">
            {meta?.candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                isActive={
                  current.table === c.table && current.joinColumn === c.joinColumn && current.labelColumn === c.labelColumn
                }
                selected={selectedId === c.id}
                onSelect={() => void selectCandidate(c)}
              />
            ))}
          </div>

          {selectedCandidate && (
            <PreviewPanel
              candidateName={selectedCandidate.displayName}
              loading={previewLoading}
              error={previewError}
              preview={preview}
              savable={savable}
              parentEntityLabel={parentEntityLabel}
            />
          )}

          {saveMsg && (
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
              disabled={!savable || saving || selectedIsActive}
              title={selectedIsActive ? "Bu eşleme zaten aktif" : undefined}
            >
              {saving ? "Kaydediliyor…" : selectedIsActive ? "Zaten aktif" : "Kaydet"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div aria-live="polite" aria-busy="true">
      <div className="ik-skeleton" style={{ width: "60%", marginBottom: 8 }} />
      <div className="ik-skeleton" style={{ width: "90%" }} />
    </div>
  );
}

function LoadErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="ik-msg bad" style={{ marginBottom: 12 }}>
      Yüklenemedi: {message}{" "}
      <button type="button" className="ik-btn ghost" onClick={onRetry} style={{ marginLeft: 8 }}>
        Tekrar dene
      </button>
    </div>
  );
}

function CurrentSourceBadge({
  current,
  displayName,
  hint,
}: {
  current: { table: string; joinColumn: string; labelColumn: string };
  displayName: string | null;
  hint?: string;
}) {
  return (
    <div className="ik-current-wrap" style={{ marginBottom: 16 }}>
      <div className="ik-current" style={{ marginBottom: hint ? 4 : 0 }}>
        <span className="ik-badge neutral">Aktif kaynak</span>
        <span className="ik-current-src">
          {current.table}.{current.joinColumn} → {current.table}.{current.labelColumn}
        </span>
        <span className="ik-muted">{displayName ?? "(küratörlü listede yok — özel eşleme)"}</span>
      </div>
      {hint && <p className="ik-help" style={{ margin: 0 }}>{hint}</p>}
    </div>
  );
}

function CandidateCard({
  candidate,
  isActive,
  selected,
  onSelect,
}: {
  candidate: Candidate;
  isActive: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const liveOk = candidate.live.tableExists && candidate.live.joinColumnExists && candidate.live.labelColumnExists;
  return (
    <button
      type="button"
      role="listitem"
      className="ik-cand"
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="ik-cand-head">
        <span className="ik-cand-name">
          {candidate.displayName}
          {isActive && (
            <span className="ik-badge good" style={{ marginLeft: 8 }}>
              ✓ Aktif
            </span>
          )}
        </span>
        <span className="ik-cand-src">
          {candidate.table}.{candidate.joinColumn}
        </span>
      </div>
      <p className="ik-cand-desc">{candidate.description}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {!liveOk && <span className="ik-badge bad">Bu ortamda bulunamadı</span>}
        {liveOk && candidate.live.typeMismatch && (
          <span className="ik-badge warn">Tip uyumsuzluğu ⚠ (CAST gerekebilir)</span>
        )}
      </div>
    </button>
  );
}

function PreviewPanel({
  candidateName,
  loading,
  error,
  preview,
  savable,
  parentEntityLabel,
}: {
  candidateName: string;
  loading: boolean;
  error: string | null;
  preview: PreviewResponse | null;
  savable: boolean;
  parentEntityLabel: string;
}) {
  return (
    <div className="ik-preview" aria-live="polite">
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Önizleme — {candidateName}</div>

      {loading && (
        <div aria-busy="true">
          <div className="ik-skeleton" style={{ width: "70%", marginBottom: 6 }} />
          <div className="ik-skeleton" style={{ width: "40%" }} />
        </div>
      )}

      {!loading && error && <div role="alert" className="ik-msg bad">{error}</div>}

      {!loading && !error && preview && !savable && (
        <div role="alert" className="ik-msg bad">
          Bu aday canlı şemada doğrulanamadı — tablo veya kolon bu ortamda bulunamadı (tableExists=
          {String(preview.live.tableExists)}, joinColumnExists={String(preview.live.joinColumnExists)},
          labelColumnExists={String(preview.live.labelColumnExists)}). Kaydedilemez.
        </div>
      )}

      {!loading && !error && preview && savable && (
        <PreviewResult
          sampleValues={preview.sampleValues!}
          matchRate={preview.matchRate!}
          live={preview.live}
          parentEntityLabel={parentEntityLabel}
        />
      )}
    </div>
  );
}

function PreviewResult({
  sampleValues,
  matchRate,
  live,
  parentEntityLabel,
}: {
  sampleValues: string[];
  matchRate: { matched: number; total: number; rate: number };
  live: { typeMismatch: boolean; joinColumnDataType: string | null; lookupKeyDataType: string | null };
  parentEntityLabel: string;
}) {
  const tone = matchRateTone(matchRate.rate);
  return (
    <>
      {live.typeMismatch && (
        <div className="ik-badge warn" style={{ marginBottom: 8 }}>
          Tip uyumsuzluğu ⚠ — {live.joinColumnDataType} vs {live.lookupKeyDataType}, JOIN bazı satırlarda sessizce eşleşmeyebilir
        </div>
      )}
      <div className="ik-muted">Örnek değerler (ilk {sampleValues.length}):</div>
      <div className="ik-samples">
        {sampleValues.length === 0 && <span className="ik-muted">Örnek değer yok.</span>}
        {sampleValues.map((v, i) => (
          <span key={i} className="ik-chip">{v}</span>
        ))}
      </div>
      <div className="ik-muted">
        Eşleşme oranı: {(matchRate.rate * 100).toFixed(1)}% ({matchRate.matched}/{matchRate.total} {parentEntityLabel})
      </div>
      <div className="ik-rate-bar">
        <div className={`ik-rate-fill ${tone}`} style={{ width: `${Math.min(100, Math.round(matchRate.rate * 100))}%` }} />
      </div>
      {tone !== "good" && (
        <div className="ik-msg" style={{ color: "var(--color-warn)", marginTop: 6 }}>
          Düşük eşleşme oranı — kaydetmeden önce bu kırılımın doğru olduğundan emin olun.
        </div>
      )}
    </>
  );
}
