export const KOMUTA_CSS = `
.komuta-root {
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 4px 0 20px 0;
  -webkit-font-smoothing: antialiased;
}
.komuta-root * { box-sizing: border-box; }

/* PAGE HEADER — risk/ziyaret sayfalarındaki tasarıma uyumlu */
.komuta-root .komuta-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 18px;
}
.komuta-root .komuta-page-header-main { flex: 1; }
.komuta-root .komuta-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 6px;
  padding: 3px 8px;
  margin-bottom: 8px;
}
.komuta-root .komuta-eyebrow-dot {
  width: 6px; height: 6px;
  background: #6366f1;
  border-radius: 50%;
  animation: komuta-pulse 2s infinite;
}
.komuta-root .komuta-page-title {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.3px;
  color: #1c1917;
  margin: 0 0 6px 0;
  line-height: 1.15;
}
.komuta-root .komuta-page-desc {
  font-size: 14px;
  color: #44403c;
  line-height: 1.55;
  margin: 0;
  max-width: 720px;
}
.komuta-root .komuta-page-desc strong { color: #1c1917; font-weight: 600; }
.komuta-root .komuta-page-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  flex-shrink: 0;
}
.komuta-root .live-indicator {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; background: rgba(22, 163, 74, 0.1);
  border: 1px solid rgba(22, 163, 74, 0.25); border-radius: 999px;
  font-size: 11px; color: #16a34a;
}
.komuta-root .live-dot { width: 6px; height: 6px; background: #16a34a; border-radius: 50%; animation: komuta-pulse 2s infinite; }
.komuta-root .refresh-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px; background: #6366f1;
  border: 1px solid #6366f1; border-radius: 6px;
  font-size: 12px; color: #ffffff; font-weight: 500; text-decoration: none;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(28, 25, 23, 0.05);
}
.komuta-root .refresh-btn:hover { background: #4f46e5; }
@keyframes komuta-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* FILTER BAR */
.komuta-root .filter-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; background: #ffffff; border: 1px solid #d6d3d1;
  border-radius: 8px; margin-bottom: 14px;
}
.komuta-root .filter-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; background: #fafaf9; border: 1px solid #d6d3d1;
  border-radius: 6px; font-size: 12px; color: #44403c; cursor: pointer;
}
.komuta-root .filter-chip.active { background: rgba(99, 102, 241, 0.12); border-color: #6366f1; color: #6366f1; }
.komuta-root .filter-chip .caret { font-size: 9px; opacity: 0.6; }
.komuta-root .filter-spacer { flex: 1; }
.komuta-root .toggle-group { display: flex; gap: 8px; }
.komuta-root .toggle {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: #fafaf9; border: 1px solid #d6d3d1;
  border-radius: 6px; font-size: 11px; color: #78716c; cursor: help;
}
.komuta-root .toggle.on { background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.4); color: #6366f1; }
.komuta-root .toggle-link { text-decoration: none; cursor: pointer; }
.komuta-root .toggle-link:hover { border-color: rgba(99, 102, 241, 0.6); }
.komuta-root .switch { width: 26px; height: 14px; background: #d6d3d1; border-radius: 999px; position: relative; flex-shrink: 0; }
.komuta-root .switch::after { content: ''; position: absolute; width: 10px; height: 10px; background: #78716c; border-radius: 50%; top: 2px; left: 2px; transition: 0.2s; }
.komuta-root .toggle.on .switch { background: #6366f1; }
.komuta-root .toggle.on .switch::after { background: #ffffff; left: 14px; }

/* CALENDAR BANNER */
.komuta-root .cal-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; margin-bottom: 14px;
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.12) 0%, rgba(99, 102, 241, 0.04) 100%);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-left: 3px solid #6366f1;
  border-radius: 6px;
  font-size: 12px;
}
.komuta-root .cal-banner-icon { font-size: 16px; flex-shrink: 0; }
.komuta-root .cal-banner-text { flex: 1; color: #44403c; line-height: 1.5; }
.komuta-root .cal-banner-text strong { color: #1c1917; font-weight: 600; }
.komuta-root .cal-banner-cta {
  flex-shrink: 0; padding: 5px 12px;
  background: rgba(99, 102, 241, 0.18); border: 1px solid rgba(99, 102, 241, 0.4);
  border-radius: 5px; font-size: 11px; color: #6366f1; cursor: pointer; font-weight: 500;
  text-decoration: none;
}

/* REEL TL banner (toggle aktif olduğunda) */
.komuta-root .demo-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; margin-bottom: 14px;
  background: rgba(217, 119, 6, 0.08);
  border: 1px solid rgba(217, 119, 6, 0.3);
  border-left: 3px solid #d97706;
  border-radius: 6px;
  font-size: 12px;
}
.komuta-root .demo-banner-icon { font-size: 16px; flex-shrink: 0; }
.komuta-root .demo-banner-text { flex: 1; color: #44403c; line-height: 1.5; }
.komuta-root .demo-banner-text strong { color: #1c1917; font-weight: 600; }
.komuta-root .demo-banner-text code {
  font-family: var(--font-mono, monospace);
  background: rgba(217, 119, 6, 0.12);
  border: 1px solid rgba(217, 119, 6, 0.25);
  padding: 1px 4px; border-radius: 3px; font-size: 11px;
  color: #b45309;
}

.komuta-root .reel-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; margin-bottom: 14px;
  background: linear-gradient(90deg, rgba(147, 51, 234, 0.14) 0%, rgba(147, 51, 234, 0.04) 100%);
  border: 1px solid rgba(147, 51, 234, 0.35);
  border-left: 3px solid #9333ea;
  border-radius: 6px;
  font-size: 12px;
}
.komuta-root .reel-banner-icon { font-size: 16px; flex-shrink: 0; }
.komuta-root .reel-banner-text { flex: 1; color: #44403c; line-height: 1.5; }
.komuta-root .reel-banner-text strong { color: #1c1917; font-weight: 600; }
.komuta-root .reel-banner-cta {
  flex-shrink: 0; padding: 5px 12px;
  background: rgba(147, 51, 234, 0.18); border: 1px solid rgba(147, 51, 234, 0.4);
  border-radius: 5px; font-size: 11px; color: #9333ea; font-weight: 500;
  text-decoration: none;
}
.komuta-root .reel-banner-cta:hover { background: rgba(147, 51, 234, 0.28); }

/* ÖTV-net banner (toggle aktif olduğunda) */
.komuta-root .otv-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 16px; margin-bottom: 14px;
  background: linear-gradient(90deg, rgba(22, 163, 74, 0.12) 0%, rgba(22, 163, 74, 0.04) 100%);
  border: 1px solid rgba(22, 163, 74, 0.3);
  border-left: 3px solid #16a34a;
  border-radius: 6px;
  font-size: 12px;
}
.komuta-root .otv-banner-icon { font-size: 16px; flex-shrink: 0; }
.komuta-root .otv-banner-text { flex: 1; color: #44403c; line-height: 1.5; }
.komuta-root .otv-banner-text strong { color: #1c1917; font-weight: 600; }
.komuta-root .otv-banner-cta {
  flex-shrink: 0; padding: 5px 12px;
  background: rgba(22, 163, 74, 0.18); border: 1px solid rgba(22, 163, 74, 0.4);
  border-radius: 5px; font-size: 11px; color: #16a34a; font-weight: 500;
  text-decoration: none;
}
.komuta-root .otv-banner-cta:hover { background: rgba(22, 163, 74, 0.28); }

/* KPI STRIP */
.komuta-root .kpi-strip-wrap { margin-bottom: 14px; }
.komuta-root .kpi-strip-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; padding: 0 2px; }
.komuta-root .kpi-strip-label { font-size: 10.5px; color: #6366f1; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
.komuta-root .kpi-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
.komuta-root .kpi-card {
  background: #ffffff; border: 1px solid #d6d3d1; border-radius: 10px;
  padding: 14px 16px; position: relative; overflow: hidden;
}
.komuta-root .kpi-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent, #6366f1), transparent);
  opacity: 0.6;
}
.komuta-root .kpi-label {
  font-size: 10.5px; color: #78716c; text-transform: uppercase;
  letter-spacing: 0.6px; font-weight: 500; margin-bottom: 8px;
}
.komuta-root .kpi-value { font-size: 26px; font-weight: 700; letter-spacing: -0.6px; color: #1c1917; line-height: 1.1; }
.komuta-root .kpi-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px; flex-wrap: wrap; }
.komuta-root .delta-up { color: #16a34a; }
.komuta-root .delta-down { color: #dc2626; }
.komuta-root .kpi-sub { color: #a8a29e; font-size: 10.5px; }

/* MAIN GRID */
.komuta-root .main-grid {
  display: grid; grid-template-columns: 1.3fr 1fr; gap: 14px; margin-bottom: 14px;
}
.komuta-root .panel {
  background: #ffffff; border: 1px solid #d6d3d1; border-radius: 10px;
  padding: 16px;
}
.komuta-root .panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.komuta-root .panel-title { font-size: 13px; font-weight: 600; color: #1c1917; display: flex; align-items: center; gap: 8px; }
.komuta-root .panel-title .icon { font-size: 14px; }
.komuta-root .panel-meta { font-size: 11px; color: #78716c; }
.komuta-root .map-panel-meta { display: flex; align-items: center; gap: 12px; }
.komuta-root .empty-note { color: #a8a29e; font-size: 12px; padding: 20px 0; text-align: center; }

/* TURKEY MAP */
.komuta-root .map-panel { position: relative; }
.komuta-root .map-svg { width: 100%; height: 360px; display: block; }
.komuta-root .map-legend {
  margin-top: 8px; padding: 8px 12px;
  background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;
  font-size: 10.5px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center;
}
.komuta-root .map-panel .legend-item { display: flex; align-items: center; gap: 5px; color: #44403c; }
.komuta-root .map-panel .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.komuta-root .map-unplaced-pills {
  margin-top: 12px; padding: 10px 12px;
  background: rgba(120, 113, 108, 0.04); border: 1px solid #e7e5e4;
  border-radius: 6px;
}
.komuta-root .map-unplaced-label {
  font-size: 10px; color: #78716c; text-transform: uppercase;
  letter-spacing: 0.6px; font-weight: 600; margin-bottom: 8px;
}
.komuta-root .map-unplaced-row {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.komuta-root .unplaced-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  background: #fafaf9; border: 1px solid #d6d3d1;
  font-size: 11px; color: #44403c;
  max-width: 100%; min-width: 0;
}
.komuta-root .unplaced-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.komuta-root .unplaced-pill.tone-hot .unplaced-dot { background: #16a34a; }
.komuta-root .unplaced-pill.tone-medium .unplaced-dot { background: #6366f1; }
.komuta-root .unplaced-pill.tone-muted .unplaced-dot { background: #78716c; }
.komuta-root .unplaced-pill.tone-cool .unplaced-dot { background: #dc2626; }
.komuta-root .unplaced-pill.tone-hot { border-color: rgba(22, 163, 74, 0.3); }
.komuta-root .unplaced-pill.tone-medium { border-color: rgba(99, 102, 241, 0.3); }
.komuta-root .unplaced-pill.tone-cool { border-color: rgba(220, 38, 38, 0.3); }
.komuta-root .unplaced-name {
  font-weight: 500; max-width: 180px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.komuta-root .unplaced-num {
  color: #1c1917; font-weight: 600; font-feature-settings: "tnum"; font-size: 10.5px;
}
.komuta-root .unplaced-delta {
  font-feature-settings: "tnum"; font-weight: 600; font-size: 10.5px;
  padding: 1px 5px; border-radius: 3px;
}
.komuta-root .unplaced-pill.tone-hot .unplaced-delta {
  background: rgba(22, 163, 74, 0.15); color: #16a34a;
}
.komuta-root .unplaced-pill.tone-medium .unplaced-delta {
  background: rgba(99, 102, 241, 0.15); color: #6366f1;
}
.komuta-root .unplaced-pill.tone-muted .unplaced-delta {
  background: rgba(120, 113, 108, 0.15); color: #78716c;
}
.komuta-root .unplaced-pill.tone-cool .unplaced-delta {
  background: rgba(220, 38, 38, 0.15); color: #dc2626;
}

/* DONUT + TREND */
.komuta-root .donut-wrap { display: flex; align-items: center; gap: 18px; margin-bottom: 12px; }
.komuta-root .donut-svg { width: 130px; height: 130px; flex-shrink: 0; }
.komuta-root .channel-list { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.komuta-root .channel-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; font-size: 12px; }
.komuta-root .channel-name { display: flex; align-items: center; gap: 8px; color: #44403c; min-width: 0; flex: 1; }
.komuta-root .channel-pip { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
.komuta-root .channel-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.komuta-root .channel-num { color: #1c1917; font-weight: 600; font-feature-settings: "tnum"; }
.komuta-root .channel-pct { color: #78716c; font-size: 11px; margin-left: 6px; font-feature-settings: "tnum"; }
.komuta-root .trend-mini { display: flex; gap: 4px; align-items: flex-end; height: 60px; padding: 8px 0; border-top: 1px solid #e7e5e4; }
.komuta-root .trend-bar { flex: 1; background: linear-gradient(180deg, #6366f1, #4f46e5); border-radius: 2px 2px 0 0; min-height: 6px; opacity: 0.85; }
.komuta-root .trend-bar.peak { background: linear-gradient(180deg, #a16207, #6366f1); opacity: 1; }
.komuta-root .trend-bar.ramazan { background: linear-gradient(180deg, #9333ea, #9333ea); opacity: 0.6; }
.komuta-root .trend-labels { display: flex; gap: 4px; font-size: 10px; color: #a8a29e; margin-top: 4px; }
.komuta-root .trend-labels span { flex: 1; text-align: center; }

/* CALENDAR SHRED */
.komuta-root .section-eyebrow {
  font-size: 10px; color: #a8a29e; text-transform: uppercase; letter-spacing: 0.8px;
  margin: 18px 0 8px 4px; font-weight: 600;
}
.komuta-root .calendar-track {
  position: relative; height: 130px;
  background: linear-gradient(180deg, #ffffff 0%, #ffffff 100%);
  border: 1px solid #d6d3d1; border-radius: 8px;
  padding: 12px 16px 8px 16px;
  margin-bottom: 14px;
}
.komuta-root .cal-month-grid { position: relative; display: grid; grid-template-columns: repeat(12, 1fr); height: 100%; }
.komuta-root .cal-month { border-right: 1px dashed #e7e5e4; position: relative; padding: 0 4px; }
.komuta-root .cal-month:last-child { border-right: none; }
.komuta-root .cal-month-label { font-size: 10px; color: #a8a29e; text-align: center; padding-top: 4px; font-weight: 500; }
.komuta-root .cal-month-label.current { color: #6366f1; font-weight: 700; }
.komuta-root .cal-trend-svg { position: absolute; left: 16px; right: 16px; top: 36px; height: 60px; width: calc(100% - 32px); }
.komuta-root .cal-legend-row { display: flex; gap: 16px; padding: 8px 4px 0 4px; font-size: 10.5px; color: #78716c; }
.komuta-root .legend-item { display: flex; align-items: center; gap: 5px; color: #44403c; }
.komuta-root .legend-dot { width: 8px; height: 8px; border-radius: 50%; }

/* CALENDAR V2 — mockup parity (HTML overlay + SVG hybrid, 3-row band area) */
.komuta-root .cal-v2 {
  position: relative;
  background: linear-gradient(180deg, #ffffff 0%, #ffffff 100%);
  border: 1px solid #d6d3d1;
  border-radius: 8px;
  padding: 10px 16px 6px 16px;
  margin-bottom: 14px;
  height: 168px;
  box-sizing: border-box;
}
.komuta-root .cal-v2-months {
  position: absolute;
  inset: 10px 16px auto 16px;
  height: 16px;
}
.komuta-root .cal-v2-month-lbl {
  position: absolute;
  transform: translateX(-50%);
  font-size: 10.5px;
  color: #a8a29e;
  font-weight: 500;
  white-space: nowrap;
}
.komuta-root .cal-v2-month-lbl.current { color: #6366f1; font-weight: 700; }

/* SVG: sadece eğriler ve bugün dot — bantlar yok */
.komuta-root .cal-v2-svg {
  position: absolute;
  left: 16px;
  right: 16px;
  top: 28px;
  width: calc(100% - 32px);
  height: 80px;
}

/* Overlay container: SVG'nin altında, 2-satır bant/marker alanı */
.komuta-root .cal-v2-overlay {
  position: absolute;
  inset: 28px 16px 24px 16px;
  pointer-events: none;
}

/* 2 satır: üst (görseller) + alt (etiketler aynı hizada) */
.komuta-root .cal-v2-visuals-row {
  position: absolute;
  left: 0;
  right: 0;
  top: 84px;
  height: 12px;
}
.komuta-root .cal-v2-labels-row {
  position: absolute;
  left: 0;
  right: 0;
  top: 100px;
  height: 16px;
}

.komuta-root .cal-v2-band-line {
  position: absolute;
  top: 4px;
  height: 4px;
  border-radius: 2px;
}
.komuta-root .cal-v2-band-line.summer  { background: #16a34a; }
.komuta-root .cal-v2-band-line.ramazan { background: #9333ea; }

.komuta-root .cal-v2-marker-dot {
  position: absolute;
  top: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6366f1;
  border: 1px solid #ffffff;
  transform: translateX(-50%);
}

.komuta-root .cal-v2-lbl {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  line-height: 14px;
}
.komuta-root .cal-v2-lbl.summer  { color: #16a34a; }
.komuta-root .cal-v2-lbl.ramazan { color: #9333ea; }
.komuta-root .cal-v2-lbl.marker  { color: #78716c; font-weight: 500; }
.komuta-root .cal-v2-lbl.today-badge {
  color: #dc2626;
  font-weight: 700;
  background: rgba(220, 38, 38, 0.12);
  border: 1px solid #dc2626;
  border-radius: 3px;
  padding: 0 5px;
  font-size: 9px;
  line-height: 14px;
  transform: translateX(-100%);
}

/* "Bugün" kırmızı yazı — eğri seviyesinde dot'un sağında */
.komuta-root .cal-v2-today-text {
  position: absolute;
  transform: translate(10px, -50%);
  font-size: 11px;
  font-weight: 700;
  color: #dc2626;
  white-space: nowrap;
  pointer-events: none;
}

.komuta-root .cal-v2-legend {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding-top: 4px;
  border-top: 1px solid #e7e5e4;
  font-size: 10px;
  color: #44403c;
}
.komuta-root .cal-v2-dash {
  display: inline-block;
  width: 14px;
  height: 0;
  border-top: 1.5px dashed #78716c;
  vertical-align: middle;
}

/* BATTLE GRID */
.komuta-root .battle-grid { display: grid; grid-template-columns: 1fr 1.3fr; gap: 14px; margin-bottom: 14px; }
.komuta-root .upcoming {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(147, 51, 234, 0.06));
  border: 1px solid #d6d3d1; border-radius: 10px; padding: 18px;
  position: relative; overflow: hidden;
}
.komuta-root .upcoming::before {
  content: ''; position: absolute; top: 0; right: 0; width: 100px; height: 100px;
  background: radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, transparent 70%);
  pointer-events: none;
}
.komuta-root .upcoming-eyebrow { font-size: 10.5px; color: #6366f1; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; margin-bottom: 6px; position: relative; }
.komuta-root .upcoming-title { font-size: 22px; font-weight: 700; color: #1c1917; letter-spacing: -0.5px; margin-bottom: 4px; position: relative; }
.komuta-root .upcoming-date { font-size: 12px; color: #78716c; margin-bottom: 14px; position: relative; }
.komuta-root .upcoming-stat-grid { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: #fafaf9; border: 1px solid #d6d3d1; border-radius: 6px; margin-bottom: 12px; position: relative; }
.komuta-root .upcoming-stat-row { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; padding: 3px 0; }
.komuta-root .upcoming-stat-row .lbl { color: #78716c; }
.komuta-root .upcoming-stat-row .val { font-weight: 600; color: #16a34a; font-feature-settings: "tnum"; }
.komuta-root .upcoming-action-row { font-size: 12px; color: #44403c; line-height: 1.5; margin-bottom: 8px; position: relative; }
.komuta-root .upcoming-action-row .hi { color: #6366f1; font-weight: 600; }
.komuta-root .upcoming-window { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(220, 38, 38, 0.08); border: 1px solid rgba(220, 38, 38, 0.3); border-radius: 6px; font-size: 11.5px; color: #dc2626; font-weight: 500; position: relative; }

/* MATRIX */
.komuta-root .matrix-panel { padding: 16px; }
.komuta-root .matrix-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.komuta-root .matrix-table th { text-align: right; padding: 8px 10px; font-size: 10px; color: #78716c; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #d6d3d1; }
.komuta-root .matrix-table th:first-child { text-align: left; }
.komuta-root .matrix-table th .sub { display: block; font-size: 9px; color: #a8a29e; font-weight: 500; text-transform: none; letter-spacing: 0; margin-top: 2px; }
.komuta-root .matrix-table th.current { color: #6366f1; }
.komuta-root .matrix-table td { padding: 7px 10px; border-bottom: 1px solid #e7e5e4; text-align: right; font-feature-settings: "tnum"; color: #44403c; }
.komuta-root .matrix-table td:first-child { text-align: left; color: #1c1917; font-weight: 500; }
.komuta-root .matrix-table tr:last-child td { border-bottom: none; }
.komuta-root .matrix-table tr:hover td { background: rgba(99, 102, 241, 0.04); }
.komuta-root .matrix-cell-current { background: rgba(99, 102, 241, 0.06); color: #6366f1 !important; font-weight: 600; }
.komuta-root .delta-pill { display: inline-block; font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; font-weight: 600; }
.komuta-root .delta-pill.up { background: rgba(22, 163, 74, 0.15); color: #16a34a; }
.komuta-root .delta-pill.down { background: rgba(220, 38, 38, 0.15); color: #dc2626; }

/* HEATMAP */
.komuta-root .heatmap-panel { padding: 16px; margin-bottom: 14px; }
.komuta-root .heatmap-grid { display: grid; gap: 4px; font-size: 11px; }
.komuta-root .heatmap-grid > .h-head { display: flex; align-items: center; justify-content: center; text-align: center; padding: 6px 4px; font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; border-bottom: 1px solid #d6d3d1; min-height: 32px; }
.komuta-root .heatmap-grid .h-region { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 6px 6px; min-height: 48px; color: #1c1917; font-weight: 600; font-size: 10.5px; border-bottom: 1px solid #e7e5e4; gap: 2px; overflow: hidden; }
.komuta-root .heatmap-grid .h-region .reg-sub { font-size: 9px; color: #a8a29e; font-weight: 400; }
.komuta-root .heatmap-grid .h-cell { display: flex; align-items: center; justify-content: center; padding: 6px 4px; min-height: 48px; text-align: center; font-feature-settings: "tnum"; font-weight: 600; border-bottom: 1px solid #e7e5e4; border-radius: 4px; }
/* Heatmap paleti — 3 pastel ton: kırmızı (negatif) / gri (nötr) / yeşil (pozitif). */
.komuta-root .heatmap-grid .h-cell.cold,
.komuta-root .heatmap-grid .h-cell.cool { background: #fecaca; color: #991b1b; }
.komuta-root .heatmap-grid .h-cell.flat { background: #f5f5f4; color: #57534e; }
.komuta-root .heatmap-grid .h-cell.warm,
.komuta-root .heatmap-grid .h-cell.hot,
.komuta-root .heatmap-grid .h-cell.fire { background: #bbf7d0; color: #166534; }
.komuta-root .heatmap-grid .h-cell.h-cell-clickable { cursor: pointer; position: relative; transition: filter 0.15s, transform 0.15s, box-shadow 0.15s; }
.komuta-root .heatmap-grid .h-cell.h-cell-clickable:hover { filter: brightness(0.96) saturate(1.1); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(127, 29, 29, 0.18); }
.komuta-root .heatmap-grid .h-cell.h-cell-clickable:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
.komuta-root .heatmap-grid .h-avg { display: flex; align-items: center; justify-content: center; padding: 6px 4px; min-height: 48px; text-align: center; font-feature-settings: "tnum"; color: #6366f1; font-weight: 700; font-size: 11.5px; border-bottom: 1px solid #e7e5e4; border-radius: 4px; background: #fafaf9; }

/* BOTTOM GRID */
.komuta-root .bottom-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 14px; }
.komuta-root .leaderboard .lb-row { display: grid; grid-template-columns: 22px 1fr 80px 90px; gap: 10px; padding: 8px 0; border-bottom: 1px solid #e7e5e4; align-items: center; font-size: 12px; }
.komuta-root .lb-row:last-child { border-bottom: none; }
.komuta-root .lb-rank { width: 22px; height: 22px; border-radius: 50%; background: #e7e5e4; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #78716c; }
.komuta-root .lb-rank.top1 { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #ffffff; }
.komuta-root .lb-rank.top2 { background: #a8a29e; color: #ffffff; }
.komuta-root .lb-rank.top3 { background: #92400e; color: #ffffff; }
.komuta-root .lb-name { color: #1c1917; }
.komuta-root .lb-region { color: #a8a29e; font-size: 10.5px; display: block; margin-top: 1px; }
.komuta-root .lb-bar { height: 6px; background: #e7e5e4; border-radius: 3px; overflow: hidden; }
.komuta-root .lb-bar-fill { height: 100%; background: linear-gradient(90deg, #16a34a, #16a34a); border-radius: 3px; }
.komuta-root .lb-bar-fill.warn { background: linear-gradient(90deg, #6366f1, #a16207); }
.komuta-root .lb-bar-fill.bad { background: linear-gradient(90deg, #dc2626, #b91c1c); }
.komuta-root .lb-pct { font-size: 11.5px; font-weight: 600; text-align: right; font-feature-settings: "tnum"; color: #1c1917; }
.komuta-root .lb-pct.bad { color: #dc2626; }
.komuta-root .lb-pct.warn { color: #6366f1; }

/* BRAND PORTFOLIO */
.komuta-root .brand-portfolio { padding: 16px; }
.komuta-root .bp-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.komuta-root .bp-table th { text-align: right; padding: 8px 10px; font-size: 10px; color: #78716c; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid #d6d3d1; }
.komuta-root .bp-table th:first-child { text-align: left; }
.komuta-root .bp-table th.current { color: #6366f1; }
.komuta-root .bp-table td { padding: 9px 10px; border-bottom: 1px solid #e7e5e4; font-feature-settings: "tnum"; color: #44403c; }
.komuta-root .bp-table td:first-child { color: #1c1917; font-weight: 500; }
.komuta-root .bp-table td.current { color: #6366f1; font-weight: 600; text-align: right; }
.komuta-root .bp-table td.right { text-align: right; }
.komuta-root .bp-table tr:last-child td { border-bottom: none; }
.komuta-root .bp-2yspark { display: inline-flex; gap: 2px; align-items: flex-end; height: 18px; }
.komuta-root .bp-2yspark .bar { width: 4px; background: #6366f1; border-radius: 1px; opacity: 0.7; }
.komuta-root .bp-2yspark .bar.last { opacity: 1; background: linear-gradient(180deg, #a16207, #6366f1); }
.komuta-root .bp-2yspark .bar.last.declining { background: linear-gradient(180deg, #dc2626, #b91c1c); }

/* TIER BADGES (PREM / LUX / CORE) */
.komuta-root .tier-badge {
  display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px;
  margin-left: 6px; vertical-align: middle; font-weight: 600;
  letter-spacing: 0.3px; text-transform: uppercase;
  border: 1px solid;
}
.komuta-root .tier-luxury {
  background: rgba(147, 51, 234, 0.12);
  color: #9333ea;
  border-color: rgba(147, 51, 234, 0.35);
}
.komuta-root .tier-premium {
  background: rgba(99, 102, 241, 0.15);
  color: #6366f1;
  border-color: rgba(99, 102, 241, 0.35);
}
.komuta-root .tier-core {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  border-color: rgba(99, 102, 241, 0.3);
}

/* AI INSIGHT */
.komuta-root .ai-insight {
  margin-top: 14px; padding: 14px 18px;
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, rgba(99, 102, 241, 0.02) 100%);
  border: 1px solid rgba(99, 102, 241, 0.25); border-left: 3px solid #6366f1;
  border-radius: 8px; display: flex; gap: 14px; align-items: flex-start;
}
.komuta-root .ai-icon {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: #ffffff;
}
.komuta-root .ai-text { flex: 1; min-width: 0; }
.komuta-root .ai-title { font-size: 11px; font-weight: 600; color: #6366f1; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.komuta-root .ai-body { font-size: 12.5px; color: #44403c; line-height: 1.6; }
.komuta-root .ai-body strong { color: #1c1917; }
.komuta-root .ai-body p { margin-bottom: 8px; }

/* AI brief fallback — Gemini fail durumunda gösterilir */
.komuta-root .ai-brief-empty {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  background: var(--color-surface-2);
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--color-fg-2);
  margin: 12px 0;
}
.komuta-root .ai-brief-empty-icon { font-size: 18px; line-height: 1; flex-shrink: 0; }
.komuta-root .ai-brief-empty-sub { color: var(--color-muted); }
.komuta-root .ai-brief-empty-link { color: var(--color-accent); text-decoration: underline; }
.komuta-root .ai-brief-empty-link:hover { color: var(--color-accent-hover); }

.komuta-root .footer-bar {
  margin-top: 14px; padding: 10px 16px; display: flex; justify-content: space-between;
  font-size: 11px; color: #a8a29e; flex-wrap: wrap; gap: 8px;
}

/* =============================================================================
 * DARK MODE — Komuta sayfasının light hardcoded hex'leri için koyu varyant.
 * Mantık: light hardcoded değerler aşağıdaki gibi takipli override edilir;
 * surface'ler zinc, kart fill'leri koyu, fg yumuşak beyaz, kırmızı/yeşil
 * accent'ler hafif desature'lı.
 * ============================================================================= */
:root[data-theme="dark"] .komuta-root {
  background: var(--color-bg);
  color: var(--color-fg);
}
:root[data-theme="dark"] .komuta-root .panel,
:root[data-theme="dark"] .komuta-root .kpi-card,
:root[data-theme="dark"] .komuta-root .upcoming,
:root[data-theme="dark"] .komuta-root .ai-insight,
:root[data-theme="dark"] .komuta-root .channel-mix-card,
:root[data-theme="dark"] .komuta-root .cal-v2,
:root[data-theme="dark"] .komuta-root .filter-bar,
:root[data-theme="dark"] .komuta-root .demo-banner,
:root[data-theme="dark"] .komuta-root .reel-banner,
:root[data-theme="dark"] .komuta-root .otv-banner {
  background: var(--color-surface) !important;
  border-color: var(--color-border) !important;
  color: var(--color-fg) !important;
}
:root[data-theme="dark"] .komuta-root .komuta-eyebrow,
:root[data-theme="dark"] .komuta-root .section-eyebrow,
:root[data-theme="dark"] .komuta-root .panel-meta,
:root[data-theme="dark"] .komuta-root .kpi-label,
:root[data-theme="dark"] .komuta-root .kpi-strip-label,
:root[data-theme="dark"] .komuta-root .kpi-sub,
:root[data-theme="dark"] .komuta-root .kpi-meta {
  color: var(--color-muted) !important;
}
:root[data-theme="dark"] .komuta-root .panel-title,
:root[data-theme="dark"] .komuta-root h1,
:root[data-theme="dark"] .komuta-root h2,
:root[data-theme="dark"] .komuta-root h3,
:root[data-theme="dark"] .komuta-root .kpi-value,
:root[data-theme="dark"] .komuta-root .h-region {
  color: var(--color-fg) !important;
}
:root[data-theme="dark"] .komuta-root .empty-note,
:root[data-theme="dark"] .komuta-root .lb-region,
:root[data-theme="dark"] .komuta-root .upcoming-stat-row .lbl,
:root[data-theme="dark"] .komuta-root .channel-name {
  color: var(--color-fg-2) !important;
}
:root[data-theme="dark"] .komuta-root .lb-bar,
:root[data-theme="dark"] .komuta-root .trend-bar,
:root[data-theme="dark"] .komuta-root .channel-pip,
:root[data-theme="dark"] .komuta-root .legend-dot {
  /* color: kalır (data-driven), zemin sadece koyulaştırılır */
}
:root[data-theme="dark"] .komuta-root .lb-bar { background: var(--color-surface-2) !important; }
:root[data-theme="dark"] .komuta-root .trend-mini,
:root[data-theme="dark"] .komuta-root .trend-labels span {
  color: var(--color-muted) !important;
}
:root[data-theme="dark"] .komuta-root .delta-up { color: var(--color-good) !important; }
:root[data-theme="dark"] .komuta-root .delta-down { color: var(--color-bad) !important; }

/* Heatmap — pastel tonlar dark mode değişkenlerine işaret eder */
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.cold,
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.cool {
  background: var(--color-heat-neg-bg);
  color: var(--color-heat-neg-fg);
}
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.flat {
  background: var(--color-heat-flat-bg);
  color: var(--color-heat-flat-fg);
}
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.warm,
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.hot,
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell.fire {
  background: var(--color-heat-pos-bg);
  color: var(--color-heat-pos-fg);
}
:root[data-theme="dark"] .komuta-root .heatmap-grid > .h-head {
  color: var(--color-muted) !important;
  border-bottom-color: var(--color-border-strong) !important;
}
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-avg {
  background: var(--color-surface-2) !important;
  color: var(--color-accent) !important;
  border-bottom-color: var(--color-border) !important;
}
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-region,
:root[data-theme="dark"] .komuta-root .heatmap-grid .h-cell {
  border-bottom-color: var(--color-border) !important;
}

/* AI insight kartı — dark zeminde indigo-soft tinted */
:root[data-theme="dark"] .komuta-root .ai-insight {
  background: linear-gradient(180deg, var(--color-accent-soft) 0%, var(--color-surface) 100%) !important;
}
:root[data-theme="dark"] .komuta-root .ai-title { color: var(--color-accent) !important; }
:root[data-theme="dark"] .komuta-root .ai-body { color: var(--color-fg-2) !important; }
:root[data-theme="dark"] .komuta-root .ai-body strong { color: var(--color-fg) !important; }

/* Footer ve filter chip'leri */
:root[data-theme="dark"] .komuta-root .footer-bar,
:root[data-theme="dark"] .komuta-root .filter-bar .filter-meta {
  color: var(--color-muted-2) !important;
}

/* TurkeyMap (eski stilize SVG dead code) ve calendar legend */
:root[data-theme="dark"] .komuta-root .cal-v2-legend {
  color: var(--color-muted) !important;
  border-top-color: var(--color-border) !important;
}
:root[data-theme="dark"] .komuta-root .cal-v2-month-lbl {
  color: var(--color-muted) !important;
}

/* Channel mix donut/list (eski TBLMUSTERIGRUP komponenti hâlâ render edilebilir) */
:root[data-theme="dark"] .komuta-root .channel-row {
  border-bottom-color: var(--color-border) !important;
}

/* ---- Geniş kapsamlı renk override'ı ------------------------------------- */
/* Tüm hardcoded "siyah text" (#1c1917) → fg */
:root[data-theme="dark"] .komuta-root .komuta-page-desc strong,
:root[data-theme="dark"] .komuta-root .cal-banner-text strong,
:root[data-theme="dark"] .komuta-root .demo-banner-text strong,
:root[data-theme="dark"] .komuta-root .reel-banner-text strong,
:root[data-theme="dark"] .komuta-root .otv-banner-text strong,
:root[data-theme="dark"] .komuta-root .kpi-value,
:root[data-theme="dark"] .komuta-root .panel-title,
:root[data-theme="dark"] .komuta-root .upcoming-title,
:root[data-theme="dark"] .komuta-root .lb-name,
:root[data-theme="dark"] .komuta-root .lb-pct,
:root[data-theme="dark"] .komuta-root .channel-num,
:root[data-theme="dark"] .komuta-root .matrix-table td:first-child {
  color: var(--color-fg) !important;
}

/* Tüm hardcoded "orta gri text" (#44403c) → fg-2 */
:root[data-theme="dark"] .komuta-root .komuta-page-desc,
:root[data-theme="dark"] .komuta-root .cal-banner-text,
:root[data-theme="dark"] .komuta-root .demo-banner-text,
:root[data-theme="dark"] .komuta-root .reel-banner-text,
:root[data-theme="dark"] .komuta-root .otv-banner-text,
:root[data-theme="dark"] .komuta-root .map-panel .legend-item,
:root[data-theme="dark"] .komuta-root .matrix-table td,
:root[data-theme="dark"] .komuta-root .upcoming-action-row,
:root[data-theme="dark"] .komuta-root .bp-table td,
:root[data-theme="dark"] .komuta-root .channel-name,
:root[data-theme="dark"] .komuta-root .legend-item,
:root[data-theme="dark"] .komuta-root .ai-body,
:root[data-theme="dark"] .komuta-root .toggle,
:root[data-theme="dark"] .komuta-root .toggle-pill {
  color: var(--color-fg-2) !important;
}

/* Tüm hardcoded light backgroundlar (#ffffff, #fafaf9) → surface / surface-2 */
:root[data-theme="dark"] .komuta-root .toggle,
:root[data-theme="dark"] .komuta-root .toggle-pill,
:root[data-theme="dark"] .komuta-root .switch,
:root[data-theme="dark"] .komuta-root .map-panel .legend,
:root[data-theme="dark"] .komuta-root .upcoming-stat-grid,
:root[data-theme="dark"] .komuta-root .channel-mix-card,
:root[data-theme="dark"] .komuta-root .matrix-card,
:root[data-theme="dark"] .komuta-root .bp-card {
  background: var(--color-surface-2) !important;
  border-color: var(--color-border) !important;
}

/* Toggle switch top'ı (knob) — dark zeminde de hâlâ beyaz */
:root[data-theme="dark"] .komuta-root .toggle.on .switch::after,
:root[data-theme="dark"] .komuta-root .switch::after {
  background: var(--color-fg) !important;
}

/* Matrix / bp tablo border'ları */
:root[data-theme="dark"] .komuta-root .matrix-table td,
:root[data-theme="dark"] .komuta-root .bp-table td,
:root[data-theme="dark"] .komuta-root .matrix-table th,
:root[data-theme="dark"] .komuta-root .bp-table th {
  border-bottom-color: var(--color-border) !important;
}
`;
