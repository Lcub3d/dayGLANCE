import { describe, expect, it, vi } from 'vitest';
import { runSyncAfterEdit, runSyncNow } from './syncNowAction.js';

// The button used to call engine.upload() — a PUT with no read and no ETag, i.e.
// a blind overwrite of the remote. It must run the full cycle instead.
describe('the ambient cloud-sync button', () => {
  it('runs the file tier as a read-then-write cycle, never a bare upload', () => {
    const cloudSyncDownload = vi.fn();
    const cloudSyncUpload = vi.fn();   // must stay untouched: the module cannot reach it
    runSyncNow({ webdavOn: true, vaultEnabled: false, cloudSyncDownload, cloudSyncUpload });
    expect(cloudSyncDownload).toHaveBeenCalledTimes(1);
    expect(cloudSyncUpload).not.toHaveBeenCalled();
  });

  it('runs the vault cycle when the vault is enabled', () => {
    const vaultSyncNow = vi.fn();
    runSyncNow({ webdavOn: false, vaultEnabled: true, vaultSyncNow });
    expect(vaultSyncNow).toHaveBeenCalledTimes(1);
  });

  it('drives both tiers, and tolerates a missing callback', () => {
    const cloudSyncDownload = vi.fn();
    const vaultSyncNow = vi.fn();
    expect(() => runSyncNow({ webdavOn: true, vaultEnabled: true, cloudSyncDownload, vaultSyncNow })).not.toThrow();
    expect(cloudSyncDownload).toHaveBeenCalledTimes(1);
    expect(vaultSyncNow).toHaveBeenCalledTimes(1);
    expect(() => runSyncNow()).not.toThrow();
    expect(() => runSyncNow({ webdavOn: true, vaultEnabled: true })).not.toThrow();
  });

  it('does nothing when no transport is configured', () => {
    const cloudSyncDownload = vi.fn();
    const vaultSyncNow = vi.fn();
    runSyncNow({ webdavOn: false, vaultEnabled: false, cloudSyncDownload, vaultSyncNow });
    expect(cloudSyncDownload).not.toHaveBeenCalled();
    expect(vaultSyncNow).not.toHaveBeenCalled();
  });
});

// The 5-second debounce after a local edit used to call engine.upload() — the
// same blind PUT, and additionally one that 412s forever once a cycle has written
// (the verified ETag comes from a read, never from a write).
describe('the post-edit debounce', () => {
  it('runs the cycle, never a bare upload', () => {
    const cloudSyncDownload = vi.fn();
    const cloudSyncUpload = vi.fn();   // must stay untouched: the module cannot reach it
    runSyncAfterEdit({ cloudSyncDownload, cloudSyncUpload });
    expect(cloudSyncDownload).toHaveBeenCalledTimes(1);
    expect(cloudSyncUpload).not.toHaveBeenCalled();
  });

  it('tolerates a missing callback', () => {
    expect(() => runSyncAfterEdit()).not.toThrow();
    expect(() => runSyncAfterEdit({})).not.toThrow();
  });
});
