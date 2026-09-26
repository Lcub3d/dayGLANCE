import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import IndependentDoNote from './IndependentDoNote.jsx';

const t = (key) => key;

function render(props = {}) {
  return renderToStaticMarkup(<IndependentDoNote
    item={{ id: '1', title: 'Do note', record: { id: '1', title: 'Do note', notes: 'captured' } }}
    t={t}
    onFocus={() => {}}
    onHide={() => {}}
    onSaveDoNote={async () => ({ ok: true })}
    {...props}
  />);
}

describe('IndependentDoNote', () => {
  it('uses the opaque Do identity and the same direct note controls', () => {
    const html = render();

    expect(html).toContain('data-jobo-note-link="do:1"');
    expect(html).toContain('data-jobo-do-note="1"');
    expect(html).toContain('class="jobo-s5-hover-actions"');
    expect(html).toContain('class="jobo-s5-note-hide"');
    expect(html).toContain('class="jobo-s5-note-delete"');
    expect(html).toContain('<textarea');
  });

  it('keeps Do notes after a pending write from being submitted twice', () => {
    const html = render({ pendingIds: ['1'] });

    expect(html).toContain('readonly=""');
    expect(html).toContain('jobo.view.pendingSave');
    expect(html).toMatch(/class="jobo-s5-note-delete"[^>]*disabled=""/);
  });

  it('keeps deleted records visible as read only conflict tiles', () => {
    const html = render({ item: { id: '1', title: 'Deleted Do', record: { id: '1', title: 'Deleted Do', notes: 'old', deleted: true } } });

    expect(html).toContain('jobo.view.recordChanged');
    expect(html).not.toContain('<textarea');
    expect(html).toMatch(/class="jobo-s5-note-delete"[^>]*disabled=""/);
  });

  it('makes read only mode explicit without changing the record identity', () => {
    const html = render({ doWritable: false });

    expect(html).toContain('data-jobo-note-kind="do"');
    expect(html).not.toContain('<textarea');
    expect(html).toMatch(/class="jobo-s5-note-delete"[^>]*disabled=""/);
  });

  it('accepts the parent selection state without changing the opaque note link', () => {
    const html = render({ selected: true });

    expect(html).toContain('data-jobo-note-link="do:1"');
    expect(html).toContain('jobo-s5-selected');
  });
});
