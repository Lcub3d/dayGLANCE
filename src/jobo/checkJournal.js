import { completionMoment } from './completionMarker.js';

// A reading of the already-filtered day model, not another ledger or another
// comparison implementation. In particular, never pass timeline estimates in
// place of model.untimedRecords: a completion point is not measured time.
const byId = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

// Manual entries may be recorded out of order. The journal orders sessions
// by their displayed execution time, never by the time the row was edited.
const attemptStart = record => {
  const point = record.timing === 'timed'
    ? { date: record.date, time: record.startTime } : completionMoment(record.createdAt);
  return point ? `${point.date} ${point.time}` : '';
};

export function buildCheckJournal(model) {
  const entries = [...(model?.timedRecords || []), ...(model?.untimedRecords || [])]
    .map(item => {
      const attempts = [...(item.attempts || [item.record])]
        .sort((a, b) => byId(attemptStart(a), attemptStart(b)) || byId(a.id, b.id));
      const measuredSessions = attempts.filter(record => record.timing === 'timed'
        && record.timingBasis !== 'planDuration').length;
      return {
        ...item,
        attempts,
        measuredSessions,
        unmeasuredAttempts: attempts.length - measuredSessions,
        // This is only the selected day's slice, never the group's duration.
        recordedMinutes: item.record.timing === 'timed' && item.record.timingBasis !== 'planDuration'
          ? item.durationMinutes : null,
      };
    })
    .sort((a, b) => a.startMinute - b.startMinute
      || a.endMinute - b.endMinute || byId(a.id, b.id));
  return { entries, invalidRecordCount: model?.invalidRecordCount || 0 };
}
