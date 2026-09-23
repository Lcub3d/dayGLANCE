import { describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import zhCN from '../../public/locales/zh-CN/translation.json';
import uk from '../../public/locales/uk/translation.json';
import en from '../../public/locales/en/translation.json';

// Capture the hook's pure suggestion builder; no DOM events are needed here.
vi.mock('react', () => ({
  useState: (value) => [value, vi.fn()],
  useRef: (value) => ({ current: value }),
  useEffect: () => {},
}));
import useNewTaskInput from './useNewTaskInput.js';

describe('task-input clock preference', () => {
  it.each([false, true])('passes the saved clock preference to actual suggestions (%s)', async (use24HourClock) => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } } });
    const { buildSuggestions } = useNewTaskInput({
      allTags: [], showAddTask: true, t: i18n.t.bind(i18n), language: 'zh-CN', use24HourClock,
    });
    const display = buildSuggestions('Task ~9', 7).find(item => item.value === '21:00').display;
    const expected = new Intl.DateTimeFormat('zh-CN', {
      hour: use24HourClock ? '2-digit' : 'numeric', minute: '2-digit',
      hourCycle: use24HourClock ? 'h23' : 'h12', timeZone: 'UTC',
    }).format(new Date('2026-01-01T21:00:00Z'));
    expect(display).toBe(expected);
  });
});

describe('task-input duration suggestions', () => {
  const suggest = async (lng, resources) => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng, resources: { [lng]: { translation: resources } } });
    const { buildSuggestions } = useNewTaskInput({
      allTags: [], showAddTask: true, t: i18n.t.bind(i18n), language: lng, use24HourClock: true,
    });
    return buildSuggestions('Task %1', 7).filter(item => item.type === 'duration');
  };

  it('renders the label and value through the translated duration ladder', async () => {
    const ukDisplays = (await suggest('uk', uk)).map(item => item.display);
    expect(ukDisplays).toEqual([
      `${uk.common.duration}: 15 хв`,
      `${uk.common.duration}: 1 г 45 хв`,
      `${uk.common.duration}: 2 г`,
      `${uk.common.duration}: 2 г 30 хв`,
    ]);
    const enDisplays = (await suggest('en', en)).map(item => item.display);
    expect(enDisplays).toContain('Duration: 15m');
    expect(enDisplays).toContain('Duration: 1h 45m');
    expect(enDisplays).toContain('Duration: 2h');
  });
});
