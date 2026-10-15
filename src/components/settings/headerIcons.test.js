import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// docs/settings-redesign.md, Header: the bell (notifications) and the save icon
// (backup) moved into Settings; sync, Obsidian, MCP, Settings, Day Dial, theme
// and help stay. Both desktop header variants are pinned.
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

describe.each(['../DesktopHeader.jsx', '../DesktopLayout.jsx'])('%s', (file) => {
  const source = read(file);

  it('no longer opens the notifications or backup dialogs', () => {
    expect(source).not.toContain('setShowRemindersSettings(true)');
    expect(source).not.toContain('setShowBackupMenu(true)');
  });

  it('keeps Settings, Day Dial, theme and help', () => {
    expect(source).toContain('setShowSettings(true)');
    expect(source).toContain('setShowDayDial(true)');
    expect(source).toContain('setDarkMode(!darkMode)');
    expect(source).toContain('setShowHelpModal(true)');
  });

  it('puts Settings between the theme toggle and help', () => {
    const at = (needle) => source.indexOf(needle);
    expect(at('onClick={() => setDarkMode(!darkMode)}')).toBeLessThan(at('onClick={() => setShowSettings(true)}'));
    expect(at('onClick={() => setShowSettings(true)}')).toBeLessThan(at('onClick={() => setShowHelpModal(true)}'));
  });
});

describe('dialogs opened from a Settings page', () => {
  // The auto-backup manager and the restore confirmation open from Settings →
  // Backup & Restore, which stays open beneath them; Settings is z-50.
  it.each(['../AutoBackupManagerModal.jsx', '../RestoreConfirmModal.jsx'])('%s sits above Settings', (file) => {
    expect(read(file)).toContain('z-[60]');
  });
});
