import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createICloudSnapshotTransport, ICLOUD_DOWNLOAD_GRACE_MS } from './icloudSnapshotTransport.js';
import { classifySnapshotText } from './snapshotFileSync.js';

/**
 * The bounded download wait, on a fake iOS bridge.
 *
 * ICloudBridge.readSync answers {"downloading":true} whenever the local copy
 * is not current. With an idle Mac rewriting the file every cycle that state
 * lasted minutes (twelve once, 2026-10-05), and an edit made on the phone in
 * that window reached nobody. After the grace period the transport asks for
 * the bytes the phone already holds, so the cycle merges and writes.
 */
const SNAPSHOT = JSON.stringify({ version: 2, lastModified: '2026-10-05T01:00:00.000Z', data: { tasks: [], unscheduledTasks: [] } });
const DOWNLOADING = '{"downloading":true}';

const T0 = 1_700_000_000_000;

function mountIOS({ reads }) {
  const readICloudSync = vi.fn((allowStale) => reads(allowStale === true));
  globalThis.window = {
    DayGlanceIOS: true,
    DayGlanceNative: {
      readICloudSync,
      writeICloudSync: vi.fn(() => '{"ok":true}'),
      iCloudAvailable: () => '{"available":true}',
    },
  };
  return readICloudSync;
}

describe('iCloud transport: bounded download wait (iOS)', () => {
  let now;
  beforeEach(() => { now = T0; });
  afterEach(() => { delete globalThis.window; });

  it('reports downloading, and only after the grace period asks for the stale bytes', async () => {
    // Fresh read says downloading; a stale read has the last downloaded bytes.
    const read = mountIOS({ reads: (stale) => (stale ? SNAPSHOT : DOWNLOADING) });
    const transport = createICloudSnapshotTransport({ now: () => now });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'downloading' });
    now += ICLOUD_DOWNLOAD_GRACE_MS - 1;
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'downloading' });
    expect(read.mock.calls.every(([stale]) => stale !== true)).toBe(true);

    now += 1;
    const r = await transport.read();
    expect(classifySnapshotText(r).kind).toBe('snapshot');
    expect(read.mock.calls.at(-1)[0]).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a successful read resets the clock, so the next stall gets a full grace period', async () => {
    let fresh = DOWNLOADING;
    const read = mountIOS({ reads: (stale) => (stale ? SNAPSHOT : fresh) });
    const transport = createICloudSnapshotTransport({ now: () => now });

    await transport.read(); // starts the clock
    now += ICLOUD_DOWNLOAD_GRACE_MS / 2;
    fresh = SNAPSHOT;
    expect(classifySnapshotText(await transport.read()).kind).toBe('snapshot');
    fresh = DOWNLOADING;
    now += ICLOUD_DOWNLOAD_GRACE_MS / 2 + 1;
    // Half a grace period after the reset: still waiting, no stale read yet.
    expect(classifySnapshotText(await transport.read()).kind).toBe('downloading');
    expect(read.mock.calls.filter(([stale]) => stale === true)).toHaveLength(0);
  });

  it('a file with no downloaded bytes keeps reporting downloading even past the grace period', async () => {
    // The bridge answers downloading to the stale request too (.notDownloaded / .icloud stub).
    const read = mountIOS({ reads: () => DOWNLOADING });
    const transport = createICloudSnapshotTransport({ now: () => now });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await transport.read();
    now += ICLOUD_DOWNLOAD_GRACE_MS;
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'downloading' });
    expect(read.mock.calls.at(-1)[0]).toBe(true);
    warn.mockRestore();
  });

  it('an error or absent answer is passed through untouched and resets the clock', async () => {
    let fresh = DOWNLOADING;
    mountIOS({ reads: () => fresh });
    const transport = createICloudSnapshotTransport({ now: () => now });
    await transport.read();
    fresh = '{"error":"iCloud not available"}';
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'error', error: 'iCloud not available' });
    fresh = 'null';
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'absent' });
  });

  it('writes through the bridge and reports its ok flag', async () => {
    mountIOS({ reads: () => SNAPSHOT });
    const transport = createICloudSnapshotTransport({ now: () => now });
    expect(await transport.write('{}')).toBe(true);
    window.DayGlanceNative.writeICloudSync = () => '{"ok":false,"error":"full"}';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await transport.write('{}')).toBe(false);
    err.mockRestore();
  });
});
