import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import UndoToast from './UndoToast.jsx';
import en from '../../public/locales/en/translation.json';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key) => key.split('.').reduce((value, part) => value?.[part], en),
}) }));

const render = (toast) => renderToStaticMarkup(
  <UndoToast toast={toast} setToast={vi.fn()} darkMode={false} isMobile={false} onUndo={vi.fn()} onRedo={vi.fn()} onFollowUp={vi.fn()} />,
);

describe('the undo toast', () => {
  it('offers Undo after an action, and Redo after an undo', () => {
    const done = render({ message: 'Completed "Write report"', actionable: true });
    expect(done).toContain('Completed &quot;Write report&quot;');
    expect(done).toContain('data-undo-action');
    expect(done).not.toContain('data-redo-action');

    const undone = render({ message: 'Undone: Completed "Write report"', redoable: true });
    expect(undone).toContain('data-redo-action');
    expect(undone).toContain('>Redo<');
    expect(undone).not.toContain('data-undo-action');
  });

  it('lets clicks through a passive note, and takes them for one with a button', () => {
    expect(render({ message: 'Nothing to undo' })).toContain('pointer-events-none');
    expect(render({ message: 'Undone', redoable: true })).toContain('pointer-events-auto');
  });

  it('is announced politely, unless it is a warning', () => {
    const note = render({ message: 'Undone' });
    expect(note).toContain('role="status"');
    expect(note).not.toContain('data-toast-kind');

    const warning = render({ message: en.backup.storageFull, kind: 'warning' });
    expect(warning).toContain('role="alert"');
    expect(warning).toContain('data-toast-kind="warning"');
    expect(warning).toContain('bg-amber-700');
    // It can be held to read, so it takes the pointer.
    expect(warning).toContain('pointer-events-auto');
  });

  it('offers a follow-up beside Undo after a completion', () => {
    const html = render({ message: 'Completed "Write report"', actionable: true, followUp: { id: 't1' } });
    expect(html).toContain('data-follow-up-action');
    expect(html).toContain('data-undo-action');
  });
});
