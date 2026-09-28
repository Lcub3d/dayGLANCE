import { describe, it, expect, vi } from 'vitest';
import { calendarDefaults, readCalendarPreferences, saveCalendarPreferences, YEAR2_CALENDAR_KEY } from './preferences.js';
import { collectDeviceSettings, applyDeviceSettings } from '../../utils/deviceSettings.js';
function store(value) {
  const map = new Map(value == null ? [] : [[YEAR2_CALENDAR_KEY, value]]);
  return { getItem: vi.fn(k => map.get(k) ?? null), setItem: vi.fn((k,v) => map.set(k,v)), removeItem: k => map.delete(k),
    key: i => [...map.keys()][i], get length() { return map.size; } };
}
describe('device-local calendar display preferences', () => {
  it('defaults lunar layers by UI language, never a holiday jurisdiction', () => {
    expect(calendarDefaults('zh-CN')).toMatchObject({ lunar: true, region: 'none' });
    expect(calendarDefaults('en')).toMatchObject({ lunar: false, region: 'none' });
    expect(calendarDefaults('zh-Hans-SG').region).toBe('none');
  });
  it('does not write just because the calendar was read or the language changed', () => {
    const storage = store();
    expect(readCalendarPreferences(storage, 'zh-CN').preferences.lunar).toBe(true);
    expect(readCalendarPreferences(storage, 'en').preferences.lunar).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('persists explicit choices across a language change', () => {
    const storage = store(); saveCalendarPreferences(storage, { lunar: false, region: 'CN' }, 'zh-CN');
    expect(readCalendarPreferences(storage, 'en').preferences).toMatchObject({ lunar: false, region: 'CN' });
  });
  it('reads the latest settings when merging a patch and never touches native task storage', () => {
    const storage = store();
    saveCalendarPreferences(storage, { region: 'CN' }, 'en');
    saveCalendarPreferences(storage, { density: 'overview' }, 'en');
    expect(readCalendarPreferences(storage, 'en').preferences).toMatchObject({ region: 'CN', density: 'overview' });
    expect(storage.setItem.mock.calls.every(([key]) => key === YEAR2_CALENDAR_KEY)).toBe(true);
  });
  it.each(['bad JSON','null','[]','{"version":2}','{"version":1,"lunar":"false"}'])('does not overwrite malformed or future preferences (%s)', raw => {
    const storage = store(raw);
    expect(saveCalendarPreferences(storage, { region: 'CN' }, 'zh-CN').error).toBe('read');
    expect(storage.getItem(YEAR2_CALENDAR_KEY)).toBe(raw); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('retains the prior value on a failed write, with a visible error signal', () => {
    const storage = store(JSON.stringify(calendarDefaults('en')));
    storage.setItem.mockImplementation(() => { throw Error('quota'); });
    const next = saveCalendarPreferences(storage, { region: 'CN' }, 'en');
    expect(next.error).toBe('write'); expect(next.preferences.region).toBe('none');
  });
  it('rejects invalid jurisdictions rather than silently activating one', () => {
    expect(saveCalendarPreferences(store(), { region: 'US' }, 'en').error).toBe('write');
  });
  it('rides the native local-device backup/restore and reset paths', () => {
    const storage = store(); saveCalendarPreferences(storage, { region: 'CN', lunar: true }, 'en');
    const backup = collectDeviceSettings(storage), restored = store();
    expect(applyDeviceSettings(backup, restored)).toBe(1);
    expect(readCalendarPreferences(restored, 'en')).toEqual(readCalendarPreferences(storage, 'en'));
    restored.removeItem(YEAR2_CALENDAR_KEY);
    expect(readCalendarPreferences(restored, 'en').preferences).toEqual(calendarDefaults('en'));
  });
});
