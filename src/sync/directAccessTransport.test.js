import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDirectAccessTransport,
  DIRECT_ACCESS_LAST_SYNCED_KEY,
  DIRECT_ACCESS_PREF_KEY,
} from './directAccessTransport.js';
import { classifySnapshotText } from './snapshotFileSync.js';

const makeStorage = (initial = {}) => {
  const m = { ...initial };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    dump: () => ({ ...m }),
  };
};

/** A fake of window.electronAPI.directAccess with a scriptable folder. */
const makeBridge = (over = {}) => {
  const b = {
    folder: { configured: true, path: '/Users/me/Drive/GLANCE', name: 'GLANCE', reachable: true },
    file: { kind: 'absent' },
    changed: null,
    restore: vi.fn(async () => b.folder),
    status: vi.fn(async () => b.folder),
    pick: vi.fn(async () => b.folder),
    disconnect: vi.fn(async () => true),
    read: vi.fn(async () => b.file),
    write: vi.fn(async () => true),
    deleteFile: vi.fn(async () => true),
    onChanged: vi.fn((cb) => { b.changed = cb; return () => { b.changed = null; }; }),
    ...over,
  };
  return b;
};

const flush = () => new Promise((r) => setTimeout(r, 0));

const make = ({ bridge = makeBridge(), storage = makeStorage(), present = true } = {}) => {
  const transport = createDirectAccessTransport({
    bridge: () => (present ? bridge : null),
    storage: () => storage,
    log: { warn: vi.fn() },
  });
  return { transport, bridge, storage };
};

describe('support and availability', () => {
  it('is unsupported without the Electron bridge, and schedules nothing', () => {
    const { transport } = make({ present: false });
    expect(transport.isSupported()).toBe(false);
    expect(transport.isAvailable()).toBe(false);
    expect(transport.getSnapshot()).toMatchObject({ supported: false, status: 'unknown', connected: false });
  });

  it('restores the remembered folder on first use, and is available once it has', async () => {
    const { transport, bridge } = make();
    expect(transport.isAvailable()).toBe(false); // kicks the restore
    await flush();
    expect(bridge.restore).toHaveBeenCalledTimes(1);
    expect(transport.isAvailable()).toBe(true);
    expect(transport.getSnapshot()).toMatchObject({ status: 'connected', name: 'GLANCE', connected: true, enabled: true });
    // Only once per session.
    transport.isAvailable();
    await flush();
    expect(bridge.restore).toHaveBeenCalledTimes(1);
  });

  it('with no folder remembered it is disconnected and unavailable', async () => {
    const bridge = makeBridge({ folder: { configured: false } });
    const { transport } = make({ bridge });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'disconnected', connected: false, name: null });
    expect(transport.isAvailable()).toBe(false);
    expect(transport.isConnected()).toBe(false);
  });

  it('a folder that is remembered but not reachable is connected-but-unreachable, and re-probed on each availability check', async () => {
    const bridge = makeBridge();
    bridge.folder = { ...bridge.folder, reachable: false };
    const { transport } = make({ bridge });
    const kicks = vi.fn();
    transport.onChanged(kicks);
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot()).toMatchObject({ status: 'unreachable', connected: true });
    expect(transport.isAvailable()).toBe(false);
    await flush();
    expect(bridge.status).toHaveBeenCalledTimes(1);
    expect(kicks).not.toHaveBeenCalled();

    // The share mounts: the next check sees it and kicks a cycle.
    bridge.folder = { ...bridge.folder, reachable: true };
    expect(transport.isAvailable()).toBe(false);
    await flush();
    expect(transport.getSnapshot().status).toBe('connected');
    expect(transport.isAvailable()).toBe(true);
    expect(kicks).toHaveBeenCalledTimes(1);
  });

  it('a restore that throws leaves the device disconnected rather than stuck on unknown', async () => {
    const bridge = makeBridge({ restore: vi.fn(async () => { throw new Error('ipc down'); }) });
    const { transport } = make({ bridge });
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot().status).toBe('disconnected');
  });
});

describe('read mapping onto the shared cycle contract', () => {
  let t;
  beforeEach(async () => {
    t = make();
    t.transport.subscribe(() => {});
    await flush();
  });

  it('absent → null, downloading → placeholder, text → text', async () => {
    t.bridge.file = { kind: 'absent' };
    expect(classifySnapshotText(await t.transport.read())).toEqual({ kind: 'absent' });
    t.bridge.file = { kind: 'downloading' };
    expect(classifySnapshotText(await t.transport.read())).toEqual({ kind: 'downloading' });
    t.bridge.file = { kind: 'text', text: '{"version":2,"data":{"tasks":[]}}' };
    expect(classifySnapshotText(await t.transport.read())).toMatchObject({ kind: 'snapshot' });
    expect(t.transport.getSnapshot().status).toBe('connected');
  });

  it('an error marks the folder unreachable so later cycles wait quietly', async () => {
    t.bridge.file = { kind: 'error', error: 'folder not found' };
    expect(classifySnapshotText(await t.transport.read())).toEqual({ kind: 'error', error: 'folder not found' });
    expect(t.transport.getSnapshot().status).toBe('unreachable');
    expect(t.transport.isAvailable()).toBe(false);
  });

  it('an unexpected shape is an error, never an absent file', async () => {
    t.bridge.file = undefined;
    expect(classifySnapshotText(await t.transport.read()).kind).toBe('error');
  });

  it('write and deleteSnapshot pass through as booleans', async () => {
    expect(await t.transport.write('{}')).toBe(true);
    expect(t.bridge.write).toHaveBeenCalledWith('{}');
    t.bridge.write = vi.fn(async () => undefined);
    expect(await t.transport.write('{}')).toBe(false);
    expect(await t.transport.deleteSnapshot()).toBe(true);
  });
});

describe('transport contract constants', () => {
  it('never reseeds plaintext over an unreadable encrypted file, never prompts, throttles longer than iCloud', () => {
    const { transport } = make();
    expect(transport.allowsPlaintextReseed).toBe(false);
    expect(transport.firstRunDecided()).toBe(true);
    expect(transport.writeThrottleMs).toBeGreaterThan(5000);
    expect(transport.lastSyncedKey).toBe(DIRECT_ACCESS_LAST_SYNCED_KEY);
    expect(transport.kicksOnVisibility()).toBe(true);
  });
});

describe('per-device switch', () => {
  it('is on by default once connected, off only when stored as off, and re-enabling kicks a cycle', async () => {
    const { transport, storage } = make();
    const kicks = vi.fn();
    transport.onChanged(kicks);
    expect(transport.isEnabled()).toBe(true);
    transport.setEnabled(false);
    expect(storage.getItem(DIRECT_ACCESS_PREF_KEY)).toBe('false');
    expect(transport.isEnabled()).toBe(false);
    expect(transport.getSnapshot().enabled).toBe(false);
    expect(kicks).not.toHaveBeenCalled();
    transport.setEnabled(true);
    expect(transport.isEnabled()).toBe(true);
    expect(kicks).toHaveBeenCalledTimes(1);
  });
});

describe('picking and disconnecting', () => {
  it('guard: picking a folder forgets the old last-synced stamp, turns the switch on, and kicks a cycle', async () => {
    const storage = makeStorage({ [DIRECT_ACCESS_LAST_SYNCED_KEY]: '2026-10-01T00:00:00.000Z', [DIRECT_ACCESS_PREF_KEY]: 'false' });
    const bridge = makeBridge({ folder: { configured: false } });
    const { transport } = make({ bridge, storage });
    const kicks = vi.fn();
    transport.onChanged(kicks);
    transport.subscribe(() => {});
    await flush();
    expect(transport.getSnapshot().status).toBe('disconnected');

    bridge.pick = vi.fn(async () => ({ configured: true, path: '/x/Dropbox/dg', name: 'dg', reachable: true }));
    const snap = await transport.pickFolder();
    expect(snap).toMatchObject({ status: 'connected', name: 'dg', enabled: true });
    // Without this the seed guard would read an empty new folder as an
    // eviction of the old one and wait out the grace window before seeding.
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBeNull();
    expect(storage.getItem(DIRECT_ACCESS_PREF_KEY)).toBe('true');
    expect(kicks).toHaveBeenCalledTimes(1);
    expect(transport.isAvailable()).toBe(true);
  });

  it('a cancelled picker changes nothing', async () => {
    const { transport, bridge, storage } = make();
    transport.subscribe(() => {});
    await flush();
    storage.setItem(DIRECT_ACCESS_LAST_SYNCED_KEY, 'stamp');
    bridge.pick = vi.fn(async () => null);
    expect(await transport.pickFolder()).toBeNull();
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBe('stamp');
    expect(transport.getSnapshot().status).toBe('connected');
  });

  it('disconnecting forgets the folder and the stamp, and makes the transport unavailable', async () => {
    const { transport, bridge, storage } = make();
    transport.subscribe(() => {});
    await flush();
    storage.setItem(DIRECT_ACCESS_LAST_SYNCED_KEY, 'stamp');
    await transport.disconnect();
    expect(bridge.disconnect).toHaveBeenCalled();
    expect(storage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY)).toBeNull();
    expect(transport.getSnapshot()).toMatchObject({ status: 'disconnected', connected: false, name: null });
    expect(transport.isAvailable()).toBe(false);
    expect(transport.isConnected()).toBe(false);
  });
});

describe('change events and status subscription', () => {
  it('forwards the main process watcher to one subscriber set and unsubscribes cleanly', () => {
    const { transport, bridge } = make();
    const a = vi.fn(); const b = vi.fn();
    const offA = transport.onChanged(a);
    const offB = transport.onChanged(b);
    expect(bridge.onChanged).toHaveBeenCalledTimes(1);
    bridge.changed();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    bridge.changed();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
    expect(bridge.changed).toBeNull();
  });

  it('status listeners get a stable snapshot object between changes', async () => {
    const { transport } = make();
    const seen = [];
    transport.subscribe((s) => seen.push(s));
    await flush();
    const s1 = transport.getSnapshot();
    expect(transport.getSnapshot()).toBe(s1);
    transport.setEnabled(false);
    const s2 = transport.getSnapshot();
    expect(s2).not.toBe(s1);
    expect(s2.enabled).toBe(false);
    expect(seen.at(-1)).toBe(s2);
  });
});
