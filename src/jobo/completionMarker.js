// A timestamp is a point, not a measured execution interval. All civil
// coordinates come from the source stamp, never the observing device's zone.
import { DO_TIMING, validateDoRecord } from './core.js';

export function completionMarker(record) {
  if (!validateDoRecord(record).ok || record.deleted || record.timing !== DO_TIMING.UNTIMED) return null;
  const date = record.createdAt.slice(0, 10);
  const time = record.createdAt.slice(11, 16);
  const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return { date, time, startMinute: minute, endMinute: minute, point: true };
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
