import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18n from 'i18next';
import en from './public/locales/en/translation.json';
import de from './public/locales/de/translation.json';
import zh from './public/locales/zh-CN/translation.json';
import './src/index.css';
import JoboCheckPanel from './src/components/jobo/JoboCheckPanel.jsx';
import { SyncContext } from './src/context/SyncContext.jsx';
import { buildJoboDayModel } from './src/jobo/viewModel.js';
import { createDoRecord } from './src/jobo/core.js';
await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en }, de: { translation: de }, 'zh-CN': { translation: zh } }, interpolation: { escapeValue: false } });
const date = '2026-09-24';
const task = { id: 't', title: 'Live [[Project note]]', notes: '**Read-only** notes\n- [ ] Do not mutate this', date, startTime: '09:00', duration: 60 };
const make = (extra = {}) => createDoRecord({ id: 'a', title: 'Captured #work', taskId: 't', source: 'manual', progress: 'partial', timing: 'timed', date, startTime: '09:00', endDate: date, endTime: '09:30', planSnapshot: { date, startTime: '09:00', duration: 60 }, createdAt: `${date}T10:00:00+08:00`, updatedAt: `${date}T10:00:00+08:00`, observedAt: `${date}T10:00:00+08:00`, ...extra });
const initial = [make(), make({ id: 'estimate', date: '2026-09-25', endDate: '2026-09-25', timingBasis: 'planDuration' })];
window.review33Notes = [];
window.review33ShortcutCount = 0;
window.addEventListener('keydown', () => { window.review33ShortcutCount += 1; });
function App() {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(true);
  const [error, setError] = useState(null);
  const [locale, setLocale] = useState('en');
  const [dark, setDark] = useState(false);
  const model = buildJoboDayModel({ date, tasks: [task], records: rows });
  useEffect(() => { window.review33 = {
    setRows, setLoaded, setError, make,
    reset: () => { setRows(initial); setLoaded(true); setError(null); },
    language: async value => { await i18n.changeLanguage(value); setLocale(value); },
    theme: value => { document.documentElement.classList.toggle('dark', value); setDark(value); },
    snapshot: () => JSON.stringify(rows),
  }; });
  const ctx = { formatTime: value => value, darkMode: dark, cardBg: dark ? 'bg-gray-900' : 'bg-white', textPrimary: dark ? 'text-gray-100' : 'text-gray-900', textSecondary: dark ? 'text-gray-400' : 'text-gray-500', borderClass: dark ? 'border-gray-700' : 'border-gray-200' };
  return <SyncContext.Provider value={{ openInObsidian: name => window.review33Notes.push(name) }}>
    <button id="open" onClick={() => setOpen(true)}>Open journal</button>
    {open && <JoboCheckPanel model={model} date={date} loaded={loaded} error={error} onClose={() => setOpen(false)} ctx={ctx} t={i18n.getFixedT(locale)} />}
  </SyncContext.Provider>;
}
createRoot(document.getElementById('root')).render(<App />);
