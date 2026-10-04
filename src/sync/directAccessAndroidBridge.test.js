import { describe, it, expect, vi } from 'vitest';
import { createAndroidDirectAccessBridge, isAndroidDirectAccessAvailable } from './directAccessAndroidBridge.js';
import { createDirectAccessTransport } from './directAccessTransport.js';
import { classifySnapshotText } from './snapshotFileSync.js';

/** A fake of the Kotlin DirectAccessBridge: synchronous, JSON text in and out. */
const makeNative = (over = {}) => {
  const n = {
    folder: { configured: true, name: 'Sync', path: 'content://tree/x', reachable: true },
    file: { kind: 'absent' },
    status: vi.fn(() => JSON.stringify(n.folder)),
    read: vi.fn(() => JSON.stringify(n.file)),
    write: vi.fn(() => true),
    deleteSnapshot: vi.fn(() => true),
    disconnect: vi.fn(() => true),
    pickFolder: vi.fn(),
    ...over,
  };
  return n;
};

const make = (native = makeNative()) => {
  const w = {};
  const bridge = createAndroidDirectAccessBridge({ native: () => native, win: () => w });
  return { bridge, native, w };
};

describe('availability', () => {
  it('is false outside the Android WebView', () => {
    expect(isAndroidDirectAccessAvailable()).toBe(false);
  });
});

describe('synchronous calls mapped to promises', () => {
  it('status and restore parse the status JSON', async () => {
    const { bridge, native } = make();
    expect(await bridge.restore()).toEqual(native.folder);
    expect(await bridge.status()).toEqual(native.folder);
  });

  it('read parses the classification; garbage reads as null (an error to the transport)', async () => {
    const { bridge, native } = make();
    native.file = { kind: 'text', text: '{"version":2}' };
    expect(await bridge.read()).toEqual({ kind: 'text', text: '{"version":2}' });
    native.read = () => 'not json';
    expect(await bridge.read()).toBeNull();
  });

  it('write, deleteFile and disconnect return strict booleans', async () => {
    const { bridge, native } = make();
    expect(await bridge.write('{}')).toBe(true);
    expect(native.write).toHaveBeenCalledWith('{}');
    native.write = () => 'true';
    expect(await bridge.write('{}')).toBe(false);
    expect(await bridge.deleteFile()).toBe(true);
    expect(await bridge.disconnect()).toBe(true);
  });

  it('has no folder watcher', () => {
    const { bridge } = make();
    expect(bridge.onChanged).toBeUndefined();
  });
});

describe('the folder picker round trip', () => {
  it('resolves with the status MainActivity posts back, and clears its callback', async () => {
    const { bridge, native, w } = make();
    const picked = bridge.pick();
    expect(native.pickFolder).toHaveBeenCalledTimes(1);
    expect(typeof w.__dgDirectAccessPicked).toBe('function');
    // Kotlin passes the org.json object as a JS literal.
    w.__dgDirectAccessPicked({ configured: true, name: 'Drive', path: 'content://tree/y', reachable: true });
    expect(await picked).toMatchObject({ configured: true, name: 'Drive' });
    expect(w.__dgDirectAccessPicked).toBeUndefined();
  });

  it('a cancelled picker resolves null', async () => {
    const { bridge, w } = make();
    const picked = bridge.pick();
    w.__dgDirectAccessPicked(null);
    expect(await picked).toBeNull();
  });

  it('a bridge that throws on launch resolves null and leaves no callback behind', async () => {
    const native = makeNative({ pickFolder: () => { throw new Error('no activity'); } });
    const { bridge, w } = make(native);
    expect(await bridge.pick()).toBeNull();
    expect(w.__dgDirectAccessPicked).toBeUndefined();
  });

  it('a second pick before the first result settles the first as cancelled', async () => {
    const { bridge, w } = make();
    const first = bridge.pick();
    const second = bridge.pick();
    expect(await first).toBeNull();
    w.__dgDirectAccessPicked({ configured: true, name: 'Later', path: 'p', reachable: true });
    expect(await second).toMatchObject({ name: 'Later' });
  });
});

describe('through the shared transport', () => {
  const storage = () => {
    const m = {};
    return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('connects from the native status and maps reads onto the cycle contract', async () => {
    const native = makeNative();
    const { bridge } = make(native);
    const transport = createDirectAccessTransport({ bridge: () => bridge, storage: storage, log: { warn: vi.fn() } });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'connected', name: 'Sync', connected: true });
    expect(transport.isAvailable()).toBe(true);

    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'absent' });
    native.file = { kind: 'downloading' };
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'downloading' });
    native.file = { kind: 'error', error: 'permission denied' };
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'error', error: 'permission denied' });
    expect(transport.getSnapshot().status).toBe('unreachable');
  });

  it('a revoked grant at launch is connected-but-unreachable, and picking again reconnects', async () => {
    const native = makeNative();
    native.folder = { ...native.folder, reachable: false };
    const { bridge, w } = make(native);
    const transport = createDirectAccessTransport({ bridge: () => bridge, storage: storage, log: { warn: vi.fn() } });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'unreachable', connected: true });

    const picking = transport.pickFolder();
    w.__dgDirectAccessPicked({ configured: true, name: 'Sync', path: 'content://tree/x', reachable: true });
    expect(await picking).toMatchObject({ status: 'connected', enabled: true });
  });
});
