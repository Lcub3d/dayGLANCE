import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => ({ useCallback: (fn) => fn }));

const { default: useNavigation } = await import('./useNavigation.js');

// #2131: the search can be opened over the Project Planner, and every result
// navigates the calendar or the inbox behind it.
describe('handleSpotlightSelect', () => {
  it('closes the Project Planner so the result is not hidden behind it', () => {
    vi.useFakeTimers();
    const closePlanner = vi.fn();
    const setShowSpotlight = vi.fn();
    const { handleSpotlightSelect } = useNavigation({
      visibleDays: 1, effectiveViewMode: 'multi',
      selectedDate: new Date(2026, 9, 19), setSelectedDate: vi.fn(), setShowMonthView: vi.fn(),
      setShowSpotlight, isMobile: false, setMobileActiveTab: vi.fn(), setTabletActiveTab: vi.fn(),
      setInboxProjectFilter: vi.fn(), setInboxArchivedExpanded: vi.fn(), setDailyNotesModalDate: vi.fn(),
      calendarRef: { current: null }, closePlanner,
    });

    handleSpotlightSelect({ source: 'inbox', task: { id: 't1' } });

    expect(setShowSpotlight).toHaveBeenCalledWith(false);
    expect(closePlanner).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
