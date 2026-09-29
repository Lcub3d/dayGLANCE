import React from 'react';
import { TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';

/** Hex value for a Tailwind bg-* class, falling back to blue. */
const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

/** Blend a #rrggbb hex toward white by `amt` (0..1); returns an rgb() string. */
const lighten = (hex, amt) => {
  const c = (i) => { const v = parseInt(hex.slice(i, i + 2), 16); return Math.round(v + (255 - v) * amt); };
  return `rgb(${c(1)}, ${c(3)}, ${c(5)})`;
};
/** Blend a #rrggbb hex toward black by `amt` (0..1); returns an rgb() string.
 *  Used for the text-pill backgrounds so labels keep contrast on any bar. */
const darken = (hex, amt) => {
  const f = 1 - amt;
  const c = (i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)));
  return `rgb(${c(1)}, ${c(3)}, ${c(5)})`;
};

// Fade applied to open-ended (no target) bars: the bar dissolves into the page
// background instead of fading to a hardcoded colour, so it works in any theme.
const OPEN_ENDED_MASK = 'linear-gradient(to right, #000 0%, #000 55%, transparent 100%)';

export const ROADMAP_ROW_HEIGHT = 44;
const BAR_H = 28;
const CHAR_PX = 5.7;

/** Presentation only, used by the native Goal roadmap and LifeMap. Callers
 * own dates/progress/selection; rendering never invents or writes a schedule. */
export function RoadmapBar({ id, title, color, leftPct, widthPct, clippedLeft,
  clippedRight, openEnded, progress, chartW = 0, darkMode = false, selected = false,
  dimmed = false, leftText, rightText, combinedText, tooltip, onSelect,
  milestone = false, summary = false }) {
  const hex = toHex(color);
  const pct = Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress * 100))) : null;
  const trackColor = lighten(hex, 0.5), fillColor = hex, pillBg = darken(hex, 0.45);
  const barWpx = (widthPct / 100) * chartW, barLeftPx = (leftPct / 100) * chartW;
  const est = text => (text || '').length * CHAR_PX + 18;
  const estL = est(leftText), estR = est(rightText), estC = est(combinedText);
  let mode, outLeft = 0, outAlign = 'left';
  if (!openEnded && !milestone && chartW > 0 && barWpx >= estL + estR + 12) mode = 'split';
  else if (!milestone && (chartW === 0 || barWpx >= estC + 6)) mode = 'inside';
  else {
    mode = 'outside';
    const rightPos = barLeftPx + barWpx + 6;
    if (rightPos + estC <= chartW) outLeft = rightPos;
    else if (barLeftPx - estC - 6 >= 0) { outLeft = barLeftPx - 6; outAlign = 'right'; }
    else if (milestone) { outLeft = Math.min(barLeftPx + 18, Math.max(0, chartW - 100)); }
    else mode = 'inside';
  }
  const Pill = ({ children, className = '' }) => <span
    className={`relative z-10 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap ${className}`}
    style={{ background: pillBg }}>{children}</span>;
  return <div data-roadmap-row={id} className="relative w-full flex items-center transition-opacity duration-200"
    style={{ height: ROADMAP_ROW_HEIGHT, opacity: dimmed ? 0.32 : 1 }}>
    <button type="button" onClick={() => onSelect?.(id)} aria-label={title} title={tooltip}
      data-roadmap-bar={id} data-roadmap-milestone={milestone || undefined}
      className="absolute flex items-center px-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ left: `${leftPct}%`, width: milestone ? 16 : `${widthPct}%`, height: milestone ? 16 : BAR_H,
        justifyContent: mode === 'split' ? 'space-between' : 'flex-start', background: trackColor,
        borderTopLeftRadius: clippedLeft ? 0 : 8, borderBottomLeftRadius: clippedLeft ? 0 : 8,
        borderTopRightRadius: clippedRight || openEnded ? 0 : 8, borderBottomRightRadius: clippedRight || openEnded ? 0 : 8,
        borderLeft: clippedLeft ? `2px dotted ${fillColor}` : 'none', overflow: 'hidden',
        ...(milestone ? { borderRadius: 2, transform: 'translateX(-50%) rotate(45deg)' } : {}),
        ...(summary ? { background: 'transparent', border: `2px dashed ${hex}` } : {}),
        boxShadow: selected ? `0 0 0 2px ${darkMode ? '#0f172a' : '#ffffff'}, 0 0 0 4px ${fillColor}` : 'none',
        ...(openEnded ? { maskImage: OPEN_ENDED_MASK, WebkitMaskImage: OPEN_ENDED_MASK } : {}),
      }}>
      {pct !== null && !summary && <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${pct}%`, background: fillColor }} />}
      {mode === 'split' && <><Pill>{leftText}</Pill><Pill>{rightText}</Pill></>}
      {mode === 'inside' && <Pill className="max-w-full overflow-hidden"><span className="truncate">{combinedText}</span></Pill>}
    </button>
    {mode === 'outside' && chartW > 0 && <button type="button" onClick={() => onSelect?.(id)}
      className="absolute z-10 max-w-full overflow-hidden" title={tooltip}
      style={outAlign === 'left' ? { left: outLeft, top: '50%', transform: 'translateY(-50%)', maxWidth: Math.max(0, chartW - outLeft) }
        : { left: outLeft, top: '50%', transform: 'translate(-100%, -50%)', maxWidth: outLeft }}>
      <Pill>{combinedText}</Pill>
    </button>}
  </div>;
}

/** The native roadmap month ticks, shared without assuming anything about
 * node kind. The chart and labels use the same bounds and selected language. */
export function RoadmapGrid({ monthTicks, leftEdge, span, labelEvery = 1,
  textSecondary = '', darkMode = false, topPad = 12, bottomPad = 30, language = 'en', labelsOnly = false, showLabels = true, timeZone, yearLabels = false }) {
  const gridColor = darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  return <div className="pointer-events-none absolute inset-0" aria-hidden="true">
    {monthTicks.map((tick, i) => {
      if (i % labelEvery !== 0) return null;
      const x = Math.max(0, Math.min(1, (tick.ms - leftEdge) / span)) * 100;
      const atRightEdge = x > 99;
      return <div key={tick.ms} className="absolute" style={{ left: `${x}%`, top: topPad, bottom: bottomPad, width: 1, background: labelsOnly ? 'transparent' : gridColor }}>
        {showLabels && <span className={`absolute text-[10px] ${textSecondary} opacity-70 whitespace-nowrap`}
          style={{ bottom: -bottomPad + 8, ...(atRightEdge ? { right: 2, textAlign: 'right' } : { left: 2 }) }}>
          {formatLocalizedDate(new Date(tick.ms), { month: 'short', ...(yearLabels || tick.month === 0 ? { year: 'numeric' } : {}), ...(timeZone ? { timeZone } : {}) }, language)}
        </span>}
      </div>;
    })}
  </div>;
}
