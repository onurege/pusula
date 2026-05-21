import type { KomutaUpcomingEvent } from "@/lib/api";

export function CalendarBanner({ event }: { event: KomutaUpcomingEvent }) {
  return (
    <div className="cal-banner">
      <div className="cal-banner-icon">📅</div>
      <div className="cal-banner-text">
        <strong>{event.daysAhead} gün sonra {event.name}</strong>
        {" · "}({new Date(event.date).toLocaleDateString("tr-TR", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })})
        {" · "}<span style={{ color: "#78716c" }}>
          Yaklaşan Sezon panelinde geçen yıl etkisi
        </span>
      </div>
      <div className="cal-banner-cta">Sezon planını incele →</div>
    </div>
  );
}
