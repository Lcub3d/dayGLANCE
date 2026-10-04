import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DoColumn from './DoColumn.jsx';

// The pairing highlight: a Do card outlined when its task is the one under
// the pointer (desktop) or tapped (the phone, slice 8). The id to match is
// read from a `data-task-id` attribute, so it arrives as text, while a task's
// own id can be a number (older tasks): the two compare as text.

const ctx = { darkMode: false, borderClass: '', textSecondary: '', currentTime: new Date('2026-10-04T12:00:00'), formatTime: (v) => v };
const item = (taskId) => ({
  id: 'do-1', startMinute: 600, endMinute: 630, leftPct: 0, widthPct: 100,
  record: { id: 'r1', progress: 'completed', timing: 'timed', date: '2026-10-04', endDate: '2026-10-04', startTime: '10:00', endTime: '10:30' },
  sourceTask: { id: taskId, color: 'bg-green-500', title: 'Call' },
});
const render = (taskId, hoverTaskId) => renderToStaticMarkup(
  <DoColumn date="2026-10-04" hourHeight={60} items={[item(taskId)]} ctx={ctx} t={(k) => k} writable={false}
    pendingIds={[]} preview={null} hoverTaskId={hoverTaskId} startHour={0} endHour={24}
    onAddAt={() => {}} onEdit={() => {}} onKeep={() => {}} onContinue={() => {}} onHoverTask={() => {}}
    onDetails={() => {}} onPointGesture={() => {}} onResizeGesture={() => {}} />,
);
const outlined = (html) => /outline:2px solid/.test(html);

describe('DoColumn pairing highlight', () => {
  // MUTATION: compare with === and a numeric task id never lights up.
  it('outlines the card of a task with a numeric id, matched by its text', () => {
    expect(outlined(render(1712345678901, '1712345678901'))).toBe(true);
  });
  it('outlines a string id, and nothing else', () => {
    expect(outlined(render('call', 'call'))).toBe(true);
    expect(outlined(render('call', 'gym'))).toBe(false);
    expect(outlined(render('call', null))).toBe(false);
  });
  it('an unlinked Do is never outlined', () => {
    expect(outlined(render(undefined, 'undefined'))).toBe(false);
  });
});

// The phone has no dragging in slice 8: no resize handle, and a completion
// marker lets the page scroll under a finger instead of capturing it.
describe('DoColumn without gestures', () => {
  const html = (gestures) => renderToStaticMarkup(
    <DoColumn date="2026-10-04" hourHeight={60} items={[item('call')]} ctx={ctx} t={(k) => k} writable gestures={gestures}
      pendingIds={[]} preview={null} hoverTaskId={null} startHour={0} endHour={24}
      onAddAt={() => {}} onEdit={() => {}} onKeep={() => {}} onContinue={() => {}} onHoverTask={() => {}}
      onDetails={() => {}} onPointGesture={() => {}} onResizeGesture={() => {}} />,
  );
  // MUTATION: ignore `gestures` and the phone shows a handle that does nothing.
  it('drops the resize handle', () => {
    const handle = /touch-action:none/;
    expect(handle.test(html(true))).toBe(true);
    expect(handle.test(html(false))).toBe(false);
  });
});
