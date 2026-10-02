// npm i --no-save playwright && npx playwright install chromium
// node scripts/verify-jobo-statistics-browser.mjs
// Uses the real panel, translations, styles and ledger model in Chromium.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const { chromium } = await import(process.env.DAYGLANCE_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const route = '/__jobo_statistics_browser_fixture';
const moduleRoute = `${route}.jsx`;
const moduleId = `${root}${moduleRoute.slice(1)}`;
const locales = Object.fromEntries(['en', 'de', 'zh-CN'].map(language => [language, {
  translation: JSON.parse(readFileSync(new URL(`../public/locales/${language}/translation.json`, import.meta.url), 'utf8')),
}]));
const fixture = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import JoboStatsHeader from '/src/components/jobo/JoboStatsHeader.jsx';
import { DayPlannerContext } from '/src/context/DayPlannerContext.jsx';
import { FeaturesContext } from '/src/context/FeaturesContext.jsx';
import { createDoRecord } from '/src/jobo/core.js';
import { formatDuration } from '/src/utils/formatDuration.js';
import '/src/index.css';

const params = new URLSearchParams(location.search);
const darkMode = params.get('dark') === '1';
const language = params.get('language') || 'en';
document.documentElement.classList.toggle('dark', darkMode);
const i18n = i18next.createInstance();
await i18n.init({ lng: language, fallbackLng: false, resources: ${JSON.stringify(locales)}, interpolation: { escapeValue: false } });
const rows = [['2026-09-28', '10:00'], ['2026-09-29', '11:00'], ['2026-10-02', '09:30']];
const records = rows.map(([date, endTime], index) => createDoRecord({
  id: 'record-' + index, taskId: null, title: 'Work', source: 'manual', progress: 'partial',
  timing: 'timed', date, startTime: '09:00', endDate: date, endTime, planSnapshot: null,
  createdAt: date + 'T09:00:00Z', updatedAt: date + 'T09:00:00Z', observedAt: date + 'T09:00:00Z',
}));
window.statisticsShortcutLeaks = 0;
document.addEventListener('keydown', () => { window.statisticsShortcutLeaks += 1; });
window.statisticsText = {
  recorded: i18n.t('jobo.stats.recorded'),
  close: i18n.t('common.close'),
  durations: Object.fromEntries([60, 90, 180, 210, 240].map(minutes => [minutes, formatDuration(minutes, i18n.t.bind(i18n))])),
};
function Fixture() {
  const [ledger, setLedger] = useState(records);
  useEffect(() => {
    window.statisticsAppendRecord = () => setLedger(previous => [...previous, createDoRecord({
      id: 'refreshed-record', taskId: null, title: 'New work', source: 'manual', progress: 'partial',
      timing: 'timed', date: '2026-09-28', startTime: '12:00', endDate: '2026-09-28', endTime: '12:30', planSnapshot: null,
      createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z', observedAt: '2026-09-28T12:00:00Z',
    })]);
  }, []);
  const planner = {
    selectedDate: new Date('2026-09-28T12:00:00'), currentTime: new Date('2026-10-02T12:00:00'),
    tasks: [], unscheduledTasks: [], recurringTasks: [], expandedRecurringTasks: [],
    getTasksForDate: () => [], weekViewMode: 'strict', weekStartDay: 1,
    darkMode, cardBg: darkMode ? 'bg-gray-900' : 'bg-white',
    textPrimary: darkMode ? 'text-white' : 'text-gray-900',
    textSecondary: darkMode ? 'text-gray-400' : 'text-gray-500',
    borderClass: darkMode ? 'border-gray-700' : 'border-gray-200',
  };
  return <I18nextProvider i18n={i18n}><DayPlannerContext.Provider value={planner}>
    <FeaturesContext.Provider value={{ joboLoaded: true, joboRecords: ledger, joboError: null }}>
      <JoboStatsHeader />
    </FeaturesContext.Provider>
  </DayPlannerContext.Provider></I18nextProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

const server = await createServer({
  root, configFile: false, server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'jobo-statistics-browser-fixture',
    resolveId(id) { if (id === moduleRoute || id === moduleId) return moduleId; },
    load(id) { if (id === moduleId) return fixture; },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url.split('?')[0] !== route) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="' + moduleRoute + '"></script></body></html>');
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(process.env.DAYGLANCE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DAYGLANCE_CHROMIUM_EXECUTABLE } : {}) });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const [width, language, darkMode] of [[1400, 'en', false], [1024, 'en', false], [320, 'en', false], [320, 'de', true], [375, 'zh-CN', false]]) {
    const page = await browser.newPage({ viewport: { width, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}${route}?language=${language}&dark=${Number(darkMode)}`);
    for (const key of ['native', 'time', 'start']) assert.equal(await page.locator(`[data-jobo-stat="${key}"]`).isVisible(), true);
    for (const key of ['finish', 'duration']) assert.equal(await page.locator(`[data-jobo-stat="${key}"]`).isVisible(), width >= 1280);
    await page.locator('[data-jobo-statistics-toggle]').click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor();
    const close = dialog.locator('header button');
    const tab = scope => dialog.locator(`[data-jobo-statistics-scope="${scope}"]`);
    const panel = dialog.locator('[role="tabpanel"]');
    const assertFocused = async locator => assert.equal(await locator.evaluate(element => element === document.activeElement), true);
    const assertScope = async (scope, minutes) => {
      await page.waitForFunction(key => document.querySelector('[aria-selected="true"]')?.dataset.joboStatisticsScope === key, scope);
      assert.equal(await tab(scope).getAttribute('tabindex'), '0');
      assert.equal(await dialog.locator('[role="tab"][tabindex="0"]').count(), 1);
      assert.equal(await tab(scope).getAttribute('aria-controls'), await panel.getAttribute('id'));
      assert.equal(await panel.getAttribute('aria-labelledby'), await tab(scope).getAttribute('id'));
      const text = await page.evaluate(() => window.statisticsText);
      await page.waitForFunction(({ label, value }) => [...document.querySelectorAll('[role="tabpanel"] dt')]
        .find(element => element.textContent === label)?.nextElementSibling?.textContent === value,
      { label: text.recorded, value: text.durations[minutes] });
      const metric = panel.locator('dl > div').filter({ has: page.locator('dt', { hasText: text.recorded }) }).first();
      assert.equal(await metric.locator('dd').innerText(), text.durations[minutes]);
    };

    await assertFocused(close);
    await assertScope('day', 60);
    // Only the selected tab participates in the dialog's normal Tab order.
    await page.keyboard.press('Tab'); await assertFocused(tab('day'));
    await page.keyboard.press('Tab'); await assertFocused(panel);
    await page.keyboard.press('Tab'); await assertFocused(close);
    await page.keyboard.press('Shift+Tab'); await assertFocused(panel);
    await page.keyboard.press('Shift+Tab'); await assertFocused(tab('day'));
    await page.keyboard.press('Shift+Tab'); await assertFocused(close);

    for (const [scope, minutes] of [['week', 210], ['month', 180], ['allTime', 210], ['day', 60]]) {
      await tab(scope).click();
      await assertScope(scope, minutes);
    }
    // Automatic activation, wrapping, Home/End and selected-tab focus.
    for (const [key, scope, minutes] of [
      ['ArrowRight', 'week', 210], ['ArrowRight', 'month', 180], ['ArrowRight', 'allTime', 210],
      ['ArrowRight', 'day', 60], ['ArrowLeft', 'allTime', 210], ['Home', 'day', 60], ['End', 'allTime', 210],
    ]) {
      await page.keyboard.press(key);
      await assertScope(scope, minutes);
      await assertFocused(tab(scope));
    }
    await page.keyboard.press('Enter');
    await assertScope('allTime', 210);
    await page.keyboard.press('Space');
    await assertScope('allTime', 210);
    await page.evaluate(() => window.statisticsAppendRecord());
    await assertScope('allTime', 240);
    await assertFocused(tab('allTime'));
    await tab('day').click();
    await assertScope('day', 90);
    assert.equal(await page.locator('[data-jobo-stats]').getAttribute('data-recorded-minutes'), '90');
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Dialog exceeds the viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Page scrolls horizontally');
    const body = await panel.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
    assert.equal(body.overflow, 'auto');
    assert.ok(body.scroll > body.client, 'Long statistics must scroll inside the dialog');
    const colors = await dialog.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.equal(colors, darkMode ? 'rgb(17, 24, 39)' : 'rgb(255, 255, 255)');
    assert.equal(await page.evaluate(() => window.statisticsShortcutLeaks), 0, 'Modal key presses leaked to app shortcuts');

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await assertFocused(page.locator('[data-jobo-statistics-toggle]'));
    await page.locator('[data-jobo-statistics-toggle]').click();
    await dialog.waitFor();
    await page.mouse.click(1, 1);
    await dialog.waitFor({ state: 'detached' });
    await assertFocused(page.locator('[data-jobo-statistics-toggle]'));
    await page.locator('[data-jobo-statistics-toggle]').click();
    await dialog.waitFor();
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    await assertFocused(page.locator('[data-jobo-statistics-toggle]'));
    assert.deepEqual(errors, [], 'Browser page errors');
    console.log(`PASS ${width}px ${language} ${darkMode ? 'dark' : 'light'}: scopes, ledger refresh, keyboard, focus, dismissal, layout`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
