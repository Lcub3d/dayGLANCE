import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportCalendarModal from './ImportCalendarModal.jsx';

const sync = vi.hoisted(() => ({}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ({ colors: [] }) }));
vi.mock('../context/SyncContext.jsx', () => ({ useSyncCtx: () => sync }));

function descendants(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(descendants)];
}
beforeEach(() => Object.assign(sync, {
  showImportModal: true, pendingImportFile: { name: 'calendar.ics' },
  importColor: 'bg-gray-600', setImportColor: vi.fn(),
  processImportFile: vi.fn(), cancelImport: vi.fn(),
}));

describe('ImportCalendarModal import lifecycle wiring', () => {
  it('Cancel and the backdrop both call the cancellation action', () => {
    const tree = ImportCalendarModal();
    tree.props.onClick();
    const cancel = descendants(tree).find(node => node.type === 'button' && node.props.children === 'common.cancel');
    cancel.props.onClick();
    expect(sync.cancelImport).toHaveBeenCalledTimes(2);
    expect(sync.processImportFile).not.toHaveBeenCalled();
  });
  it('clicks inside the dialog stop before the backdrop', () => {
    const tree = ImportCalendarModal();
    const stopPropagation = vi.fn();
    tree.props.children.props.onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(sync.cancelImport).not.toHaveBeenCalled();
  });
  it('the two import buttons retain their mode arguments', () => {
    const tree = ImportCalendarModal();
    for (const [label, mode] of [['calendarImport.asEvents', false], ['calendarImport.asTaskCalendar', true]]) {
      const button = descendants(tree).find(node => node.type === 'button' &&
        descendants(node).some(child => child.props?.children === label));
      button.props.onClick();
      expect(sync.processImportFile).toHaveBeenLastCalledWith(mode);
    }
  });
  it('a closed modal renders nothing', () => {
    sync.showImportModal = false;
    expect(ImportCalendarModal()).toBeNull();
  });
});
