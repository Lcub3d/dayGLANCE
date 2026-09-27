// Native task priorities are stored as 3 (P1) through 0 (P4).
export const PRIORITY_LEVELS = Object.freeze({ 3: 'p1', 2: 'p2', 1: 'p3', 0: 'p4' });

export function priorityLevel(priority) {
  const value = Number(priority);
  return Number.isInteger(value) && value >= 0 && value <= 3
    ? PRIORITY_LEVELS[value]
    : 'p4';
}
