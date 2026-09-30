import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';

const context = vi.hoisted(() => ({ planner: {}, features: {}, sync: {}, seen: [] }));
vi.mock('../../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => context.planner }));
vi.mock('../../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => context.features }));
vi.mock('../../context/SyncContext.jsx', () => ({ useSyncCtx: () => context.sync }));
vi.mock('../NotesSubtasksPanel.jsx', () => ({ default: props => { context.seen.push(props); return <div data-native-notes />; } }));
import DoNotesPanel, { DoTaskNotes } from './DoNotesPanel.jsx';

describe('the Check notes destination reuses the Do card native notes content', () => {
  const task = { id: 't', title: 'Report [[Source]]', notes: 'Original', color: 'bg-red-500' };
  it('passes exactly the same native actions, task and wiki callbacks in both hosts', () => {
    context.planner = { darkMode: true, unscheduledTasks: [task], updateTaskNotes: vi.fn(),
      addSubtask: vi.fn(), toggleSubtask: vi.fn(), deleteSubtask: vi.fn(), updateSubtaskTitle: vi.fn() };
    context.features = { aiConfig: {}, aiSubtasksLoadingForTask: null, generateAISubtasks: vi.fn() };
    context.sync = { loadWikiNote: vi.fn(), saveWikiNote: vi.fn(), openInObsidian: vi.fn() };
    context.seen.length = 0;
    const card = renderToStaticMarkup(<DoNotesPanel task={task} above height={45} />);
    renderToStaticMarkup(<DoTaskNotes task={task} />);
    expect(card).toContain('data-jobo-notes'); expect(card).toContain('bottom:45px');
    expect(context.seen[0]).toEqual(context.seen[1]);
    expect(context.seen[1]).toMatchObject({ task, isInbox: true, darkMode: true, compact: false,
      updateTaskNotes: context.planner.updateTaskNotes, onLoadWikiNote: context.sync.loadWikiNote,
      onSaveWikiNote: context.sync.saveWikiNote, onOpenInObsidian: context.sync.openInObsidian, wikilinks: ['Source'] });
    for (const fn of [...Object.values(context.planner), ...Object.values(context.features), ...Object.values(context.sync)]) {
      if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    }
  });
  it('does not invent a wiki source or inbox membership for a normal task', () => {
    context.planner = { unscheduledTasks: [] }; context.features = {}; context.sync = null; context.seen.length = 0;
    renderToStaticMarkup(<DoTaskNotes task={{ ...task, title: 'Report' }} />);
    expect(context.seen[0]).toMatchObject({ isInbox: false, wikilinks: undefined, onLoadWikiNote: undefined, onSaveWikiNote: undefined });
  });
});
