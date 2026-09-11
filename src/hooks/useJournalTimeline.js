import { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_JOURNAL_STATE,
  actualBlockMatchesPlan,
  actualBlocksForDate,
  historicalPlansForDate,
  normalizeJournalState,
  observePlans as observePlanState,
  recordPlanAsActual,
  removeActualBlock as removeActualBlockFromState,
  summarizeJournalDay,
  updateActualBlock as updateActualBlockInState,
} from '../journal/model.js';

export const JOURNAL_STORAGE_KEY = 'day-planner-journal-v1';
export const JOURNAL_CHANGE_EVENT = 'dayglance-journal-change';

const makeId = prefix => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}:${uuid}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
};

const defaultStorage = () => {
  try { return globalThis.localStorage || null; } catch { return null; }
};

export function readJournalState(storage) {
  try {
    const target = storage === undefined ? defaultStorage() : storage;
    const raw = target?.getItem?.(JOURNAL_STORAGE_KEY);
    return raw ? normalizeJournalState(JSON.parse(raw)) : normalizeJournalState(EMPTY_JOURNAL_STATE);
  } catch {
    return normalizeJournalState(EMPTY_JOURNAL_STATE);
  }
}

export function writeJournalState(state, storage) {
  const normalized = normalizeJournalState(state);
  const target = storage === undefined ? defaultStorage() : storage;
  try { target?.setItem?.(JOURNAL_STORAGE_KEY, JSON.stringify(normalized)); } catch { /* keep this session usable */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(JOURNAL_CHANGE_EVENT, { detail: normalized }));
  }
  return normalized;
}

export default function useJournalTimeline() {
  const [state, setState] = useState(() => readJournalState());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const refresh = event => {
      if (event?.type === 'storage' && event.key && event.key !== JOURNAL_STORAGE_KEY) return;
      setState(event?.detail ? normalizeJournalState(event.detail) : readJournalState());
    };
    window.addEventListener(JOURNAL_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(JOURNAL_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const commit = useCallback(transform => {
    const current = readJournalState();
    const result = transform(current);
    const next = result?.state || result || current;
    if (next !== current) {
      const written = writeJournalState(next);
      setState(written);
    }
    return result;
  }, []);

  const observePlans = useCallback(tasks => commit(current => {
    const observedAt = new Date().toISOString();
    return observePlanState(current, tasks, {
      observedAt,
      idFactory: () => makeId('plan-revision'),
    });
  }), [commit]);

  const recordActual = useCallback(task => commit(current => recordPlanAsActual(current, task, {
    id: makeId('actual'),
    recordedAt: new Date().toISOString(),
    revisionIdFactory: () => makeId('plan-revision'),
  })), [commit]);

  const updateActual = useCallback((blockId, patch) => commit(current => ({
    state: updateActualBlockInState(current, blockId, patch),
  })), [commit]);

  const removeActual = useCallback(blockId => commit(current => ({
    state: removeActualBlockFromState(current, blockId),
  })), [commit]);

  const actualForDate = useCallback(dateStr => actualBlocksForDate(state, dateStr), [state]);
  const historicalForDate = useCallback(dateStr => historicalPlansForDate(state, dateStr), [state]);
  const daySummary = useCallback(dateStr => summarizeJournalDay(state, dateStr), [state]);
  const hasMatchingActual = useCallback(task => state.actualBlocks.some(block => actualBlockMatchesPlan(block, task)), [state.actualBlocks]);

  return {
    state,
    actualBlocks: state.actualBlocks,
    planRevisions: state.planRevisions,
    recordActual,
    updateActual,
    removeActual,
    observePlans,
    actualForDate,
    historicalForDate,
    daySummary,
    hasMatchingActual,
  };
}
