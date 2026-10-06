import type { UsageOverview } from "@enroute/core";
import {
  EVENT_LABELS,
  KIND_LABELS,
  formatDateTime,
  formatDay,
  formatDuration,
  screenLabel,
} from "./usage-format";

/** Sunum bileşenleri — state yok, yalnız `UsageOverview` parçalarını çizer. */

export function KpiStrip({ data }: { data: UsageOverview }) {
  const items = [
    { label: "Toplam giriş", value: data.logins.toLocaleString("tr-TR") },
    { label: "Benzersiz kullanıcı", value: data.uniqueUsers.toLocaleString("tr-TR") },
    { label: "Oturum sayısı", value: data.sessions.toLocaleString("tr-TR") },
    { label: "Ort. oturum süresi", value: formatDuration(data.avgSessionDwellMs) },
  ];
  return (
    <div className="ku-kpis">
      {items.map((k) => (
        <div key={k.label} className="ku-kpi">
          <div className="ku-kpi-label">{k.label}</div>
          <div className="ku-kpi-value">{k.value}</div>
        </div>
      ))}
    </div>
  );
}

function Bar({ ratio, tone = "accent" }: { ratio: number; tone?: "accent" | "muted" }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <span className="ku-bar" aria-hidden="true">
      <span className={`ku-bar-fill ${tone}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

export function ScreenLeaderboard({ screens }: { screens: UsageOverview["screens"] }) {
  if (screens.length === 0) return <Empty text="Bu aralıkta ekran görüntüleme yok." />;
  const maxViews = Math.max(...screens.map((s) => s.views), 1);
  const maxDwell = Math.max(...screens.map((s) => s.avgDwellMs), 1);
  return (
    <div className="ku-scroll">
      <table className="ku-table">
        <caption className="ku-sr">Ekranlara göre ziyaret ve ortalama kalış süresi</caption>
        <thead>
          <tr>
            <th scope="col">Ekran</th>
            <th scope="col">Ziyaret</th>
            <th scope="col">Ort. kalış</th>
          </tr>
        </thead>
        <tbody>
          {screens.map((s) => (
            <tr key={s.screen}>
              <th scope="row" className="ku-name">
                {screenLabel(s.screen)}
                <span className="ku-sub">{s.screen}</span>
              </th>
              <td>
                <span className="ku-cell-bar">
                  <Bar ratio={s.views / maxViews} />
                  <span className="ku-num">{s.views.toLocaleString("tr-TR")}</span>
                </span>
              </td>
              <td>
                <span className="ku-cell-bar">
                  <Bar ratio={s.avgDwellMs / maxDwell} tone="muted" />
                  <span className="ku-num">{formatDuration(s.avgDwellMs)}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UserActivity({ users }: { users: UsageOverview["users"] }) {
  if (users.length === 0) return <Empty text="Bu aralıkta kullanıcı etkinliği yok." />;
  return (
    <div className="ku-scroll">
      <table className="ku-table">
        <caption className="ku-sr">Kullanıcı bazında etkinlik</caption>
        <thead>
          <tr>
            <th scope="col">Kullanıcı</th>
            <th scope="col" className="r">Oturum</th>
            <th scope="col" className="r">Görüntüleme</th>
            <th scope="col" className="r">Toplam süre</th>
            <th scope="col">Son görülme</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username}>
              <th scope="row" className="ku-name">{u.username}</th>
              <td className="r ku-num">{u.sessions.toLocaleString("tr-TR")}</td>
              <td className="r ku-num">{u.views.toLocaleString("tr-TR")}</td>
              <td className="r ku-num">{formatDuration(u.totalDwellMs)}</td>
              <td className="ku-nowrap">{formatDateTime(u.lastSeenTs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InteractionBreakdown({ items }: { items: UsageOverview["interactions"] }) {
  if (items.length === 0) return <Empty text="Bu aralıkta etkileşim kaydı yok." />;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="ku-list">
      {items.map((i) => (
        <li key={i.interactionKind} className="ku-list-row">
          <span className="ku-list-label">{KIND_LABELS[i.interactionKind] ?? i.interactionKind}</span>
          <Bar ratio={i.count / max} />
          <span className="ku-num">{i.count.toLocaleString("tr-TR")}</span>
        </li>
      ))}
    </ul>
  );
}

export function MiniTimeline({ days }: { days: UsageOverview["timeline"] }) {
  if (days.length === 0) return <Empty text="Bu aralıkta günlük veri yok." />;
  const max = Math.max(...days.map((d) => d.views), ...days.map((d) => d.logins), 1);
  return (
    <div>
      <div className="ku-legend">
        <span><i className="ku-dot views" /> Görüntüleme</span>
        <span><i className="ku-dot logins" /> Giriş</span>
      </div>
      <div className="ku-scroll">
        <ol className="ku-timeline">
          {days.map((d) => (
            <li
              key={d.dayTs}
              className="ku-day"
              aria-label={`${formatDay(d.dayTs)}: ${d.logins} giriş, ${d.views} görüntüleme`}
              title={`${formatDay(d.dayTs)} — ${d.logins} giriş, ${d.views} görüntüleme`}
            >
              <span className="ku-day-bars" aria-hidden="true">
                <span className="ku-col views" style={{ height: `${(d.views / max) * 100}%` }} />
                <span className="ku-col logins" style={{ height: `${(d.logins / max) * 100}%` }} />
              </span>
              <span className="ku-day-label" aria-hidden="true">{formatDay(d.dayTs)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function RecentLog({ rows }: { rows: UsageOverview["recent"] }) {
  if (rows.length === 0) return <Empty text="Seçili filtrelerle olay bulunamadı." />;
  return (
    <div className="ku-scroll ku-log">
      <table className="ku-table">
        <caption className="ku-sr">Son olaylar, yeniden eskiye</caption>
        <thead>
          <tr>
            <th scope="col">Tarih</th>
            <th scope="col">Kullanıcı</th>
            <th scope="col">Olay</th>
            <th scope="col">Ekran</th>
            <th scope="col">Etkileşim</th>
            <th scope="col" className="r">Süre</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.ts}-${i}`}>
              <td className="ku-nowrap">{formatDateTime(r.ts)}</td>
              <td>{r.username ?? "—"}</td>
              <td>
                <span className={`ku-tag ${r.eventType}`}>{EVENT_LABELS[r.eventType] ?? r.eventType}</span>
              </td>
              <td>{screenLabel(r.screen)}</td>
              <td>
                {r.interactionKind
                  ? `${KIND_LABELS[r.interactionKind] ?? r.interactionKind}${r.interactionDetail ? ` · ${r.interactionDetail}` : ""}`
                  : "—"}
              </td>
              <td className="r ku-num">{formatDuration(r.dwellMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="ku-empty">{text}</p>;
}
