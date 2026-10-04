import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderFormattedText } from './textFormatting.jsx';
import { PEEK_TASK_EVENT, taskLink } from './followUp.js';

// A follow-up's note links back to the task it grew from
// (utils/followUp.js). In a note the link shows the task, inside the app,
// rather than leaving the page.

const html = (text) => renderToStaticMarkup(<div>{renderFormattedText(text)}</div>);

// The rendered link's element, found in the tree renderFormattedText returns.
const linkElement = (text) => {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const child of node) { const hit = walk(child); if (hit) return hit; } return null; }
    if (node.props?.['data-task-link'] !== undefined) return node;
    return walk(node.props?.children);
  };
  return walk(renderFormattedText(text));
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('task links in notes', () => {
  it('draws a link to the task, labelled, its id kept whole', () => {
    const out = html(`Follows up on ${taskLink({ id: 'a b', title: 'Call Robin' })}, done Sun, Oct 4.`);
    expect(out).toContain('<a href="dayglance://task?id=a%20b" data-task-link="a b"');
    expect(out).toContain('>Call Robin</a>, done Sun, Oct 4.');
  });

  it('a click asks the app to show the task and goes nowhere', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    linkElement(taskLink({ id: 42, title: 'Old' })).props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    // The note's own click (open its editor) does not also fire.
    expect(event.stopPropagation).toHaveBeenCalled();
    const sent = dispatchEvent.mock.calls[0][0];
    expect(sent.type).toBe(PEEK_TASK_EVENT);
    expect(sent.detail).toEqual({ id: '42' });
  });

  it('works inside a bullet and next to formatting', () => {
    const out = html(`- **Then** ${taskLink({ id: 1, title: 'One' })}`);
    expect(out).toContain('<strong>Then</strong>');
    expect(out).toContain('data-task-link="1"');
  });

  it('leaves other Markdown links and a broken id as typed', () => {
    const out = html('[site](https://example.com) and [bad](dayglance://task?id=%E0%A4%A)');
    expect(out).not.toContain('data-task-link');
    expect(out).toContain('[bad](dayglance://task?id=%E0%A4%A)');
    // A web address still links as before.
    expect(out).toContain('href="https://example.com');
  });
});
