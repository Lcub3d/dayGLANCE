import { describe, it, expect, vi } from 'vitest';
import { createNativeDirectAccessBridge, isNativeDirectAccessAvailable } from './directAccessNativeBridge.js';
import { createDirectAccessTransport } from './directAccessTransport.js';
import { classifySnapshotText } from './snapshotFileSync.js';

/**
 * Fakes of the two native bridges. Android's JavascriptInterface answers with
 * real booleans; iOS's dgbridge:// proxy answers everything as text, so its
 * booleans are the strings "true"/"false" and void calls answer "null".
 */
const makeNative = (platform = 'android', over = {}) => {
  const bool = (b) => (platform === 'ios' ? String(b) : b);
  const n = {
    folder: { configured: true, name: 'Sync', path: platform === 'ios' ? '/private/var/mobile/Sync' : 'content://tree/x', reachable: true },
    file: { kind: 'absent' },
    status: vi.fn(() => JSON.stringify(n.folder)),
    read: vi.fn(() => JSON.stringify(n.file)),
    write: vi.fn(() => bool(true)),
    deleteSnapshot: vi.fn(() => bool(true)),
    disconnect: vi.fn(() => bool(true)),
    pickFolder: vi.fn(() => (platform === 'ios' ? 'null' : undefined)),
    ...over,
  };
  return n;
};

const make = (native = makeNative()) => {
  const w = {};
  const bridge = createNativeDirectAccessBridge({ native: () => native, win: () => w });
  return { bridge, native, w };
};

describe('availability', () => {
  it('is false outside the native shells', () => {
    expect(isNativeDirectAccessAvailable()).toBe(false);
  });
});

describe.each(['android', 'ios'])('synchronous calls mapped to promises (%s)', (platform) => {
  it('status and restore parse the status JSON', async () => {
    const { bridge, native } = make(makeNative(platform));
    expect(await bridge.restore()).toEqual(native.folder);
    expect(await bridge.status()).toEqual(native.folder);
  });

  it('read parses the classification; garbage reads as null (an error to the transport)', async () => {
    const { bridge, native } = make(makeNative(platform));
    native.file = { kind: 'text', text: '{"version":2}' };
    expect(await bridge.read()).toEqual({ kind: 'text', text: '{"version":2}' });
    native.read = () => 'not json';
    expect(await bridge.read()).toBeNull();
    native.read = () => null; // iOS: the scheme handler answered 500
    expect(await bridge.read()).toBeNull();
  });

  it('write, deleteFile and disconnect return strict booleans whatever the native type', async () => {
    const { bridge, native } = make(makeNative(platform));
    expect(await bridge.write('{}')).toBe(true);
    expect(native.write).toHaveBeenCalledWith('{}');
    native.write = () => (platform === 'ios' ? 'false' : false);
    expect(await bridge.write('{}')).toBe(false);
    native.write = () => null;
    expect(await bridge.write('{}')).toBe(false);
    expect(await bridge.deleteFile()).toBe(true);
    expect(await bridge.disconnect()).toBe(true);
  });

  it('has no folder watcher', () => {
    const { bridge } = make(makeNative(platform));
    expect(bridge.onChanged).toBeUndefined();
  });
});

describe('the folder picker round trip', () => {
  it('resolves with the status the shell posts back, and clears its callback', async () => {
    const { bridge, native, w } = make();
    const picked = bridge.pick();
    expect(native.pickFolder).toHaveBeenCalledTimes(1);
    expect(typeof w.__dgDirectAccessPicked).toBe('function');
    // Kotlin and Swift both pass the JSON object as a JS literal.
    w.__dgDirectAccessPicked({ configured: true, name: 'Drive', path: '/x', reachable: true });
    expect(await picked).toMatchObject({ configured: true, name: 'Drive' });
    expect(w.__dgDirectAccessPicked).toBeUndefined();
  });

  it('a cancelled picker resolves null', async () => {
    const { bridge, w } = make();
    const picked = bridge.pick();
    w.__dgDirectAccessPicked(null);
    expect(await picked).toBeNull();
  });

  it('a failed pick the shell reports resolves with the error, logs the reason, and clears its callback', async () => {
    // A Nextcloud folder picked on an iPhone did nothing and nothing said why
    // (2026-10-08): the shell now posts {error, …}, which the transport shows.
    const { bridge, w } = make();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const picked = bridge.pick();
      w.__dgDirectAccessPicked({ error: 'bookmark: permission denied', path: '/x', scoped: false });
      expect(await picked).toMatchObject({ error: 'bookmark: permission denied' });
      expect(spy).toHaveBeenCalledWith('[direct-access] folder pick failed:', expect.objectContaining({ error: 'bookmark: permission denied' }));
      expect(w.__dgDirectAccessPicked).toBeUndefined();
    } finally { spy.mockRestore(); }
  });

  it('a bridge that throws on launch resolves null and leaves no callback behind', async () => {
    const native = makeNative('android', { pickFolder: () => { throw new Error('no activity'); } });
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

  it.each(['android', 'ios'])('connects from the native status and maps reads onto the cycle contract (%s)', async (platform) => {
    const native = makeNative(platform);
    const { bridge } = make(native);
    const transport = createDirectAccessTransport({ bridge: () => bridge, storage: storage, log: { warn: vi.fn() } });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'connected', name: 'Sync', connected: true });
    expect(transport.isAvailable()).toBe(true);

    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'absent' });
    native.file = { kind: 'downloading' };
    expect(classifySnapshotText(await transport.read())).toEqual({ kind: 'downloading' });
    expect(await transport.write('{"version":2}')).toBe(true);
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
