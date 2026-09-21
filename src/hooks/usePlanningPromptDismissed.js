import { useSyncExternalStore } from 'react';
import { localPromptDate, PLANNING_PROMPT_DISMISSED_KEY } from '../lifeplanner/planningChoicesPrompt.js';

export const PLANNING_PROMPT_CHANGED = 'planning-prompt-dismissed';

function getSnapshot() {
  try { return window.localStorage.getItem(PLANNING_PROMPT_DISMISSED_KEY) === localPromptDate(); }
  catch { return false; }
}

function subscribe(notify) {
  const onStorage = event => {
    if (event.key === null || event.key === PLANNING_PROMPT_DISMISSED_KEY) notify();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(PLANNING_PROMPT_CHANGED, notify);
  window.addEventListener('focus', notify);
  // Restore the entry after the local date changes, including an overnight tab.
  const timer = window.setInterval(notify, 60_000);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(PLANNING_PROMPT_CHANGED, notify);
    window.removeEventListener('focus', notify);
    window.clearInterval(timer);
  };
}

export default function usePlanningPromptDismissed() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
