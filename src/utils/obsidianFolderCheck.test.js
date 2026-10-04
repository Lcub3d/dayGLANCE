import { describe, it, expect } from 'vitest';
import { describeDailyNotePath } from './obsidianFolderCheck.js';

const fmt = (d, p) => (p === 'yyyy-MM-dd' ? '2026-10-03' : p === 'yyyy/MM/dd' ? '2026/10/03' : `x-${p}`);
const NOW = new Date(2026, 9, 3);

describe('describeDailyNotePath (the field report: a vault picked one level too deep)', () => {
  it('shows where a daily note lands: vault, folder, dated file', () => {
    expect(describeDailyNotePath({ vaultName: 'Vault', dailyNotesPath: 'Daily Notes', dailyNotePattern: '', formatDatePattern: fmt, now: NOW }))
      .toEqual({ folder: 'Daily Notes', file: '2026-10-03.md', path: 'Vault/Daily Notes/2026-10-03.md', nested: false });
    expect(describeDailyNotePath({ vaultName: 'Vault', dailyNotesPath: '', formatDatePattern: fmt, now: NOW }).path).toBe('Vault/2026-10-03.md');
    expect(describeDailyNotePath({ vaultName: 'Vault', dailyNotesPath: '/journals/', dailyNotePattern: 'yyyy/MM/dd', formatDatePattern: fmt, now: NOW }).path)
      .toBe('Vault/journals/2026/10/03.md');
  });
  it('flags the nesting shape: the picked folder is itself named like the first segment of the setting', () => {
    expect(describeDailyNotePath({ vaultName: 'Daily Notes', dailyNotesPath: 'Daily Notes', formatDatePattern: fmt, now: NOW }))
      .toMatchObject({ path: 'Daily Notes/Daily Notes/2026-10-03.md', nested: true });
    expect(describeDailyNotePath({ vaultName: 'daily notes', dailyNotesPath: 'Daily Notes/2026', formatDatePattern: fmt, now: NOW }).nested).toBe(true);
    // Not nesting: a different name, no folder, or no known vault name.
    expect(describeDailyNotePath({ vaultName: 'Vault', dailyNotesPath: 'Daily Notes', formatDatePattern: fmt, now: NOW }).nested).toBe(false);
    expect(describeDailyNotePath({ vaultName: 'Daily Notes', dailyNotesPath: '', formatDatePattern: fmt, now: NOW }).nested).toBe(false);
    expect(describeDailyNotePath({ vaultName: null, dailyNotesPath: 'Daily Notes', formatDatePattern: fmt, now: NOW }).nested).toBe(false);
  });
  it('a pattern that cannot render still previews, with the pattern in place of the date', () => {
    const boom = () => { throw new Error('bad'); };
    expect(describeDailyNotePath({ vaultName: 'V', dailyNotesPath: 'D', dailyNotePattern: 'yyyy?', formatDatePattern: boom }).path).toBe('V/D/yyyy?.md');
  });
});
