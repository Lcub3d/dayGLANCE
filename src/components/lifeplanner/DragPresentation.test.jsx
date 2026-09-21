import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DragPresentation from './DragPresentation.jsx';
import SelectionPresentation from './SelectionPresentation.jsx';

describe('DragPresentation', () => {
  it('keeps the preview text-only and exposes a disabled trash affordance at rest', () => {
    const html = renderToStaticMarkup(<DragPresentation owner="drag-1" trashLabel="Move to trash" dropToTrashLabel="Release to delete" onTrashClick={vi.fn()} />);
    expect(html).toContain('data-lp-drag-presentation');
    expect(html).toContain('data-lp-trash');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('lp-drag-ghost');
  });

  it('renders a lifted title and active trash target while dragging', () => {
    const html = renderToStaticMarkup(<DragPresentation owner="drag-2" active={{ title: 'Write a book', x: 40, y: 80, dragging: true }}
      overTrash trashLabel="Move to trash" dropToTrashLabel="Release to delete" onTrashClick={vi.fn()} />);
    expect(html).toContain('lp-drag-ghost');
    expect(html).toContain('>Write a book</span>');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('data-over="true"');
    expect(html).toContain('aria-label="Release to delete"');
    expect(html).not.toContain('disabled=""');
  });

  it('renders a pointer-transparent marquee with viewport coordinates', () => {
    const html = renderToStaticMarkup(<SelectionPresentation marquee={{ left: 12, top: 18, width: 140, height: 72 }} />);
    expect(html).toContain('lp-selection-marquee');
    expect(html).toContain('left:12px');
    expect(html).toContain('width:140px');
  });
});
