import { useMemo } from 'react';
import { collectFilterTasks, filterProjects } from './filterTasks.js';
import { organizerState } from './organizerStore.js';
import { dayKey } from './year.js';

export default function useOrganizer(ctx, features) {
  // Calendar navigation/zoom is not the filter clock. The native clock updates
  // the memo once per minute, including local midnight and hour-based queries.
  const minute = Math.floor(+(ctx.currentTime || new Date()) / 60000);
  const now = useMemo(() => new Date(minute * 60000), [minute]);
  const today = dayKey(now);
  const entries = useMemo(() => collectFilterTasks({
    tasks: ctx.tasks, unscheduledTasks: ctx.unscheduledTasks, recurringTasks: ctx.recurringTasks,
    projects: features.projects, isVisibleForUser: features.isVisibleForUser, today,
  }), [ctx.tasks, ctx.unscheduledTasks, ctx.recurringTasks, features.projects, features.isVisibleForUser, today]);
  const state = useMemo(() => organizerState(features.jobuRecords, entries.map(e => e.task)), [features.jobuRecords, entries]);
  const projects = useMemo(() => filterProjects(features.projects, entries), [features.projects, entries]);
  const options = useMemo(() => ({ now, today, projects, getLabels: state.labels.namesFor }), [now, today, projects, state.labels]);
  return { ...state, entries, options, loaded: !!features.jobuLoaded && !!ctx.dataLoaded, writable: !!features.jobuWritable };
}
