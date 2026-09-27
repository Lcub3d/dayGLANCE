// A timestamp is a point, not a measured execution interval. Completion
// timestamps with an explicit offset already carry the source civil clock.
// Recurring completion stamps currently end in Z, so their marker is projected
// into the viewer's local civil time for display only; record identity/date stay
// untouched.
import { DO_TIMING, validateDoRecord } from './core.js';

function viewerLocalCivil(stamp) {
  const instant = new Date(stamp);
  const date = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
  const time = `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

/**
 * The civil date and time a stamp shows as: its own clock when it carries an
 * offset, the viewer's local clock when it is UTC. Display only.
 */
export function completionMoment(stamp) {
  if (typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) return null;
  return /Z$/i.test(stamp) ? viewerLocalCivil(stamp) : { date: stamp.slice(0, 10), time: stamp.slice(11, 16) };
}

export function completionMarker(record) {
  if (!validateDoRecord(record).ok || record.deleted || record.timing !== DO_TIMING.UNTIMED) return null;
  const civil = completionMoment(record.createdAt);
  const minute = Number(civil.time.slice(0, 2)) * 60 + Number(civil.time.slice(3, 5));
  return { date: civil.date, time: civil.time, startMinute: minute, endMinute: minute, point: true };
}

// The caller supplies the interval endpoint chosen by the gesture. A click or
// a zero-length gesture never manufactures five/thirty minutes of execution.
export function intervalFromMarker(marker, endpoint) {
  if (!marker || !Number.isFinite(endpoint)) return null;
  const end = Math.max(0, Math.min(1440, Math.round(endpoint / 5) * 5));
  const start = Math.min(marker.startMinute, end);
  const duration = Math.abs(marker.startMinute - end);
  if (duration === 0) return null;
  const finish = start + duration;
  const endDate = new Date(Date.parse(`${marker.date}T00:00:00.000Z`) + Math.floor(finish / 1440) * 86400000).toISOString().slice(0, 10);
  const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return { timing: DO_TIMING.TIMED, date: marker.date, startTime: clock(start), endDate, endTime: clock(finish % 1440) };
}
