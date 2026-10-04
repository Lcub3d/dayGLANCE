import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A connected vault whose stored access has lapsed reads "connected" while
// every note read and vault write fails. Change Vault is the way back: it
// picks the folder again and keeps everything else. Disconnect is not, since
// it also drops the Obsidian-imported tasks (which then sync as deletions).
describe('Obsidian settings: Change Vault', () => {
  const source = readFileSync(new URL('./SettingsModal.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('data-obsidian-change-vault');
  const handler = source.slice(start, source.indexOf('</button>', start));

  it('is offered while a vault is connected', () => {
    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain("t('settings.obsidianChangeVault')");
  });

  // MUTATION: route it through disconnectVault or a task filter and this fails.
  it('re-picks the folder and keeps the configuration and every task', () => {
    expect(handler).toContain('requestVaultAccess()');
    expect(handler).toContain('obsidianVaultHandleRef.current = handle');
    expect(handler).toMatch(/setObsidianConfig\(prev => \(\{ \.\.\.prev,/);
    expect(handler).not.toMatch(/disconnectVault|setTasks|setUnscheduledTasks|removeItem/);
  });
});

// Where a lost vault shows. Before, the green check, the header dot and the
// bridge panel all read healthy ("Obsidian is not running") while the vault
// could not be reached at all.
describe('a lost vault is shown, not passed off as connected', () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

  it('Settings swaps the green check for the reason and the fix', () => {
    const source = read('./SettingsModal.jsx');
    expect(source).toMatch(/obsidianVaultAccess === 'lost'\s*\?\s*<AlertCircle/);
    expect(source).toContain("data-obsidian-vault-lost className=\"text-xs text-red-500\">{t('settings.obsidianVaultAccessLost')}");
  });

  it('the header dot turns red and says why', () => {
    const source = read('./DesktopHeader.jsx');
    expect(source).toContain("obsidianSyncStatus === 'error' || obsidianVaultAccess === 'lost' ? 'bg-red-500'");
    expect(source).toContain("t('settings.obsidianVaultAccessLost')");
  });

  it('the bridge panel says the vault is unreachable instead of "Obsidian is not running"', () => {
    const source = read('./BridgePairingPanel.jsx');
    expect(source).toMatch(/vaultLost \? \(\s*<p data-bridge-vault-unreachable/);
  });
});

// The daily-note path preview (2026-10-03 field report): the folder a note
// lands in is shown, and the nesting trap is named before the first write.
describe('the daily-note path is previewed, and the nesting shape is called out', () => {
  const source = readFileSync(new URL('./SettingsModal.jsx', import.meta.url), 'utf8');
  it('renders the resolved path under the folder setting and the warning when nested', () => {
    expect(source).toContain('describeDailyNotePath({');
    expect(source).toMatch(/data-obsidian-daily-path[^>]*>\s*\{t\('settings\.obsidianDailyNotesResolved', \{ path: resolved\.path \}\)\}/);
    expect(source).toMatch(/resolved\.nested && \(\s*<p data-obsidian-daily-nested className="text-xs text-amber-500/);
  });
});
