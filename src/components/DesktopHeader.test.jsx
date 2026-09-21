import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import DesktopHeader from './DesktopHeader.jsx';

const fixture = vi.hoisted(() => ({
  planner: {}, sync: {}, native: false, locale: 'en',
  formatRange: vi.fn(), formatMonth: vi.fn(),
}));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.planner }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => fixture.sync }));
vi.mock('../context/FeaturesContext.jsx', () => ({
  useFeaturesCtx: () => ({ activeReminders: [{}], setShowRemindersSettings: vi.fn() }),
}));
vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => fixture.native }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key, i18n: { resolvedLanguage: fixture.locale } }),
}));
vi.mock('../utils/taskUtils.js', () => ({
  dateToString: date => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
  formatDateRange: (...args) => fixture.formatRange(...args),
}));
vi.mock('../utils/localeFormatting.js', () => ({
  formatLocalizedDate: (...args) => fixture.formatMonth(...args),
  localizedWeekdays: () => ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
}));
vi.mock('./McpStatusControls.jsx', () => ({
  useMcpStatus: () => ({}),
  McpBoltButton: () => <button title="MCP" />,
  McpStatusModal: () => null,
}));

const render = () => renderToStaticMarkup(<DesktopHeader />);
const titleButton = html => html.match(/<button[^>]*class="month-view-toggle[^>]*>[\s\S]*?<\/button>/)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  fixture.locale = 'en';
  fixture.native = false;
  fixture.formatRange.mockReturnValue('Sep 22 – 24, 2026');
  fixture.formatMonth.mockReturnValue('September 2026');
  const selectedDate = new Date(2026, 8, 22);
  fixture.planner = {
    selectedDate, viewedMonth: selectedDate,
    visibleDays: 3, visibleDates: [selectedDate],
    effectiveViewMode: 'multi', dayViewColumns: [], weekViewDates: [],
    darkMode: false, showMonthView: false, monthViewActive: false,
    weatherEnabled: true, weatherTempUnit: 'celsius',
    weather: { icon: '☀️', temp: 28, high: 32, low: 24, forecast: [{ day: 'Wed', icon: '☀️', high: 30, low: 24 }] },
    dailyContentEnabled: true, dailyContent: { dadJoke: 'A sample daily item.' }, contentRotation: 0,
    cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900',
    textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
    getMonthDays: () => [null, selectedDate], getDateIndicators: () => ({}), weekStartDay: 0,
  };
  fixture.sync = {
    cloudSyncConfig: { enabled: true }, obsidianConfig: { enabled: true },
    calSyncConfigured: true, cloudSyncStatus: 'success', obsidianSyncStatus: 'success',
  };
});

describe('DesktopHeader layout', () => {
  it('reserves grid tracks for weather, dates and the full action cluster instead of overlaying dates', () => {
    const html = render();
    expect(html).toContain('grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)]');
    expect(html).not.toContain('absolute inset-0');
    expect(html).not.toContain('max-[950px]:pr-36');
    expect(html).not.toContain('pointer-events-none');
    expect(html).toContain('justify-self-end');
    expect(html).toContain('28°C');
    expect(html).toContain('title="MCP"');
    expect(html).toContain('settings.cloudSync');
    expect(html).toContain('settings.obsidian');
    expect(html).toContain('settings.viewCalendarDay');
    expect(html).toContain('height:80px');
  });

  it.each(['en', 'de', 'zh-CN'])('lets the %s date label shrink while retaining the full text and tooltip', locale => {
    fixture.locale = locale;
    fixture.formatRange.mockReturnValue('28. September – 4. Oktober 2026');
    const button = titleButton(render());
    expect(button).toContain('min-w-0 truncate');
    expect(button).not.toContain('min-w-[13rem]');
    expect(button).toContain('title="28. September – 4. Oktober 2026"');
    expect(button).toContain('>28. September – 4. Oktober 2026</button>');
    expect(fixture.formatRange).toHaveBeenCalledWith(fixture.planner.visibleDates, expect.any(Function), locale);
  });

  it('retains the month popup without clipping it to the 80px header', () => {
    fixture.planner.showMonthView = true;
    const html = render();
    expect(html).toContain('month-view-container absolute top-full');
    expect(html).toContain('z-50');
    expect(html.match(/^<div[^>]*>/)[0]).not.toContain('overflow-hidden');
    expect(html).toContain('aria-label="common.back"');
    expect(html).toContain('aria-label="common.next"');
  });

  it('still renders navigation and the Day Dial when weather and optional sync are off', () => {
    fixture.planner.weatherEnabled = false;
    fixture.sync = {};
    fixture.native = true;
    const html = render();
    expect(html).not.toContain('28°C');
    expect(html).not.toContain('settings.cloudSync');
    expect(html).toContain('settings.viewCalendarDay');
    expect(titleButton(html)).toContain('Sep 22 – 24, 2026');
  });

  it('keeps DAY deduplication, WEEK dates, JOBO single-day dates and MONTH labels unchanged', () => {
    const date = fixture.planner.selectedDate;
    fixture.planner.effectiveViewMode = 'day';
    fixture.planner.dayViewColumns = [{ dateStr: '2026-09-22', date }, { dateStr: '2026-09-22', date }];
    render();
    expect(fixture.formatRange).toHaveBeenLastCalledWith([date], expect.any(Function), 'en');
    fixture.planner.effectiveViewMode = 'week';
    fixture.planner.weekViewDates = [date, new Date(2026, 8, 23)];
    render();
    expect(fixture.formatRange).toHaveBeenLastCalledWith(fixture.planner.weekViewDates, expect.any(Function), 'en');
    fixture.planner.effectiveViewMode = 'jobo';
    render();
    expect(fixture.formatRange).toHaveBeenLastCalledWith([date], expect.any(Function), 'en');
    fixture.planner.monthViewActive = true;
    expect(titleButton(render())).toContain('title="September 2026"');
    expect(fixture.formatMonth).toHaveBeenCalledWith(date, { month: 'long', year: 'numeric' }, 'en');
  });

  it('compiles the layout with the project Tailwind version', async () => {
    const raw = readFileSync(new URL('./DesktopHeader.jsx', import.meta.url), 'utf8');
    const result = await postcss([tailwindcss({ content: [{ raw, extension: 'jsx' }], corePlugins: { preflight: false } })])
      .process('@tailwind utilities;', { from: undefined });
    const grids = [];
    result.root.walkDecls('grid-template-columns', decl => grids.push(decl.value.replace(/\s/g, '')));
    expect(grids).toContain('minmax(max-content,1fr)minmax(0,auto)minmax(max-content,1fr)');
  });
});
