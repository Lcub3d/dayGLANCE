import { describe, it, expect, vi, afterEach } from 'vitest';
import { probeVaultAccess } from './obsidian.js';
import { makeElectronVaultHandle } from './obsidianElectronHandle.js';

// A stored vault handle is not proof the vault is reachable. probeVaultAccess
// is what the sync cycle, the header and Settings believe, so a stale handle
// must answer 'lost' rather than pass for connected.

afterEach(() => vi.unstubAllGlobals());

describe('probeVaultAccess', () => {
  it('no handle is lost; a native handle reports its own failures and is not probed', async () => {
    expect(await probeVaultAccess(null)).toBe('lost');
    expect(await probeVaultAccess('native')).toBe('ok');
  });

  it('a browser handle must hold its permission and list an entry', async () => {
    const handle = (perm, next = async () => ({ done: true })) => ({
      queryPermission: async () => perm,
      keys: () => ({ next }),
    });
    expect(await probeVaultAccess(handle('granted'))).toBe('ok');
    expect(await probeVaultAccess(handle('prompt'))).toBe('lost');
    expect(await probeVaultAccess(handle('granted', async () => { throw new DOMException('gone', 'NotFoundError'); }))).toBe('lost');
  });

  it('never throws', async () => {
    expect(await probeVaultAccess({ queryPermission: async () => { throw new Error('boom'); } })).toBe('lost');
    expect(await probeVaultAccess({ probe: async () => { throw new Error('boom'); } })).toBe('lost');
  });
});

// The desktop shim always reports permission 'granted' (the main process holds
// the bookmark), which is why it needs its own probe. MUTATION: drop probe()
// from the shim and a stale bookmark reads 'ok'.
describe('the desktop vault probe', () => {
  const desktop = (stat) => {
    vi.stubGlobal('window', { electronAPI: { obsidian: { stat } } });
    return makeElectronVaultHandle();
  };

  it('asks the main process to stat the vault root', async () => {
    const stat = vi.fn(async () => ({ kind: 'directory' }));
    expect(await probeVaultAccess(desktop(stat))).toBe('ok');
    expect(stat).toHaveBeenCalledWith('');
  });

  it('a stale bookmark or a missing folder is lost, though permission still reads granted', async () => {
    const handle = desktop(async () => null);
    expect(await handle.queryPermission()).toBe('granted');
    expect(await probeVaultAccess(handle)).toBe('lost');
  });
});
