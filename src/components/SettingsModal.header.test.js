import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// #2075, the quick part: the desktop Settings dialog keeps a Close control in
// reach from anywhere in its long list, and grows with a large window. Read at
// the source level like the other SettingsModal tests (the dialog needs most
// of App's state to render).
const source = readFileSync(new URL('./SettingsModal.jsx', import.meta.url), 'utf8');
const tagAt = (marker) => {
  const i = source.indexOf(marker);
  expect(i, marker).toBeGreaterThan(-1);
  return source.slice(source.lastIndexOf('<', i), source.indexOf('>', i) + 1);
};

describe('Settings dialog header', () => {
  it('stays at the top while the content scrolls', () => {
    const header = tagAt('data-settings-header');
    expect(header).toContain('sticky top-0');
    // Opaque, so the list does not show through it as it scrolls past.
    expect(header).toContain('${cardBg}');
  });

  it('carries a labelled Close button that closes the dialog', () => {
    const start = source.indexOf('data-settings-close');
    const button = source.slice(source.lastIndexOf('<button', start), source.indexOf('</button>', start));
    expect(button).toContain('onClick={() => setShowSettings(false)}');
    expect(button).toContain("aria-label={t('common.close')}");
    // It sits in the header, ahead of every settings section.
    expect(start).toBeLessThan(source.indexOf('{/* Left column */}'));
  });

  it('is a labelled modal dialog', () => {
    const dialog = tagAt('data-settings-dialog');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-labelledby="settings-dialog-title"');
    expect(source).toContain('id="settings-dialog-title"');
  });

  it('grows past the old 768px cap on large screens', () => {
    const dialog = tagAt('data-settings-dialog');
    expect(dialog).toContain('lg:max-w-3xl');
    expect(dialog).toContain('xl:max-w-5xl');
    expect(dialog).toContain('lg:max-h-[90vh]');
  });
});

describe('Escape closes Settings', () => {
  // The issue read the dialog's own handlers only; the app-wide one closes it.
  it('through the shared modal Escape handler', () => {
    const hook = readFileSync(new URL('../hooks/useModalClose.js', import.meta.url), 'utf8');
    expect(hook).toMatch(/if \(showSettings\) \{\s*e\.preventDefault\(\);\s*setShowSettings\(false\);/);
  });
});
