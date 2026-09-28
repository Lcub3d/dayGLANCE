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
