"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { UsageOverview } from "@enroute/core";
import {
  InteractionBreakdown,
  KpiStrip,
  MiniTimeline,
  RecentLog,
  ScreenLeaderboard,
  UserActivity,
} from "./UsageSections";
import { dayEndMs, dayStartMs, toIsoDate } from "./usage-format";
import "./kullanim.css";

const LIMITS = [50, 100, 200, 500] as const;
const DAY_MS = 24 * 3600 * 1000;

type Filters = { from: string; to: string; username: string; limit: number };

function defaultFilters(): Filters {
  const now = new Date();
  return {
    from: toIsoDate(new Date(now.getTime() - 29 * DAY_MS)),
    to: toIsoDate(now),
    username: "",
    limit: 200,
  };
}

/**
 * Admin · Kullanım Analitiği. `/api/admin/usage` (Next proxy → Hono, admin
 * kapısı API'de) verisini gösterir: KPI şeridi, ekran leaderboard'u, kullanıcı
 * etkinliği, etkileşim kırılımı, günlük çizgi ve filtreli son-olaylar logu.
 * Salt-okunur; filtreler yalnız "Uygula" ile sorgu atar.
 */
export default function KullanimPage() {
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(draft);
  const [data, setData] = useState<UsageOverview | null>(null);
  const [knownUsers, setKnownUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (f: Filters) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        from: String(dayStartMs(f.from)),
        to: String(dayEndMs(f.to)),
        limit: String(f.limit),
      });
      if (f.username.trim()) qs.set("username", f.username.trim());
      const res = await fetch(`/api/admin/usage?${qs}`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) throw new Error("Bu ekran için admin yetkisi gerekli.");
      if (!res.ok) throw new Error("Kullanım verisi alınamadı.");
      const json = (await res.json()) as UsageOverview;
      if (seq !== requestSeq.current) return; // eski yanıt, yenisi yolda
      setData(json);
      setKnownUsers((prev) => [...new Set([...prev, ...json.users.map((u) => u.username)])].sort());
    } catch (e) {
      if (seq === requestSeq.current) setError((e as Error).message);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  const rangeInvalid = draft.from > draft.to;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rangeInvalid) setApplied(draft);
  }

  return (
    <div className="v3-page ku-page">
      <header className="ku-header">
        <div className="ku-eyebrow">Admin · Kullanım</div>
        <h1 className="ku-title">Kullanım Analitiği</h1>
        <p className="ku-lead">
          Kim ne sıklıkla giriyor, hangi ekranda ne kadar kalıyor, hangi kontrolleri
          kullanıyor. Veri yalnızca bu uygulamanın yerel kaydından gelir.
        </p>
        <Link href="/admin" className="ku-back">← Admin paneline dön</Link>
      </header>

      <form className="ku-filters" onSubmit={onSubmit} aria-label="Kullanım filtreleri">
        <label className="ku-field">
          <span>Başlangıç</span>
          <input
            type="date"
            value={draft.from}
            max={draft.to}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            required
          />
        </label>
        <label className="ku-field">
          <span>Bitiş</span>
          <input
            type="date"
            value={draft.to}
            min={draft.from}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            required
          />
        </label>
        <label className="ku-field">
          <span>Kullanıcı</span>
          <input
            type="text"
            list="ku-users"
            placeholder="Tümü"
            value={draft.username}
            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            autoComplete="off"
          />
          <datalist id="ku-users">
            {knownUsers.map((u) => <option key={u} value={u} />)}
          </datalist>
        </label>
        <label className="ku-field">
          <span>Log satırı</span>
          <select
            value={draft.limit}
            onChange={(e) => setDraft({ ...draft, limit: Number(e.target.value) })}
          >
            {LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="submit" className="ku-apply" disabled={loading || rangeInvalid}>
          {loading ? "Yükleniyor…" : "Uygula"}
        </button>
        {rangeInvalid && <span className="ku-err" role="alert">Başlangıç, bitişten sonra olamaz.</span>}
      </form>

      <div aria-live="polite">
        {error && <p className="ku-error" role="alert">{error}</p>}
        {!data && loading && <p className="ku-empty">Yükleniyor…</p>}
      </div>

      {data && (
        <div className={loading ? "ku-body busy" : "ku-body"}>
          <KpiStrip data={data} />

          <div className="ku-grid">
            <section className="ku-card ku-wide" aria-labelledby="ku-h-screens">
              <h2 id="ku-h-screens" className="ku-h2">Ekran leaderboard</h2>
              <ScreenLeaderboard screens={data.screens} />
            </section>

            <section className="ku-card" aria-labelledby="ku-h-inter">
              <h2 id="ku-h-inter" className="ku-h2">Etkileşim kırılımı</h2>
              <InteractionBreakdown items={data.interactions} />
            </section>

            <section className="ku-card" aria-labelledby="ku-h-time">
              <h2 id="ku-h-time" className="ku-h2">Günlük akış</h2>
              <MiniTimeline days={data.timeline} />
            </section>

            <section className="ku-card ku-wide" aria-labelledby="ku-h-users">
              <h2 id="ku-h-users" className="ku-h2">Kullanıcı etkinliği</h2>
              <UserActivity users={data.users} />
            </section>

            <section className="ku-card ku-wide" aria-labelledby="ku-h-log">
              <h2 id="ku-h-log" className="ku-h2">
                Son olaylar <span className="ku-count">{data.recent.length} satır</span>
              </h2>
              <RecentLog rows={data.recent} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
