import { describe, it, expect } from 'vitest';
import {
  backupFingerprint, canSkipRemoteUpload, readLastRemoteBackup, writeLastRemoteBackup, LAST_REMOTE_BACKUP_KEY,
} from './backupDedupe.js';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
};

describe('backupFingerprint', () => {
  it('ignores the payload timestamp and follows the data', async () => {
    const a = await backupFingerprint({ timestamp: 't1', data: { tasks: [1] } });
    const b = await backupFingerprint({ timestamp: 't2', data: { tasks: [1] } });
    const c = await backupFingerprint({ timestamp: 't1', data: { tasks: [2] } });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('is undefined for no payload, so nothing is deduplicated', async () => {
    expect(await backupFingerprint(null)).toBeUndefined();
  });
});

describe('canSkipRemoteUpload', () => {
  const last = { fingerprint: 'f', filename: 'dayglance-backup-1.json', encrypted: false };
  const files = [{ filename: 'dayglance-backup-1.json' }];

  it('skips when the same content is already on the target', () => {
    expect(canSkipRemoteUpload({ fingerprint: 'f', encrypted: false, last, remoteFiles: files })).toBe(true);
  });

  it('uploads when the content changed', () => {
    expect(canSkipRemoteUpload({ fingerprint: 'g', encrypted: false, last, remoteFiles: files })).toBe(false);
  });

  it('uploads when that file is gone (pruned, deleted, or another server)', () => {
    expect(canSkipRemoteUpload({ fingerprint: 'f', encrypted: false, last, remoteFiles: [] })).toBe(false);
  });

  it('uploads when encryption was turned on since', () => {
    expect(canSkipRemoteUpload({ fingerprint: 'f', encrypted: true, last, remoteFiles: files })).toBe(false);
  });

  it('uploads without a fingerprint or a previous upload', () => {
    expect(canSkipRemoteUpload({ fingerprint: undefined, encrypted: false, last, remoteFiles: files })).toBe(false);
    expect(canSkipRemoteUpload({ fingerprint: 'f', encrypted: false, last: null, remoteFiles: files })).toBe(false);
  });
});

describe('last remote backup record', () => {
  it('round-trips, and a record without a fingerprint clears it', () => {
    const storage = memoryStorage();
    writeLastRemoteBackup({ fingerprint: 'f', filename: 'x.json', encrypted: true }, storage);
    expect(readLastRemoteBackup(storage)).toEqual({ fingerprint: 'f', filename: 'x.json', encrypted: true });
    writeLastRemoteBackup({ fingerprint: undefined, filename: 'y.json' }, storage);
    expect(storage.map.has(LAST_REMOTE_BACKUP_KEY)).toBe(false);
    expect(readLastRemoteBackup(storage)).toBeNull();
  });
});
