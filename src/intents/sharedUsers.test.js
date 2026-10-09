import { describe, it, expect, vi } from 'vitest';

// sharedUsers.js pulls in webdavFetch (window-dependent) and the iCloud
// transport at module level; neither is exercised by resolveWebDAV, so stub
// them out to keep this a pure node test.
vi.mock('../utils/cloudSyncProviders.js', () => ({ webdavFetch: vi.fn() }));
vi.mock('./icloudFileTransport.js', () => ({ isAvailable: () => false }));

import { resolveWebDAV, reconcileRoster, syncSharedUsersViaDirectAccess } from './sharedUsers.js';

// ─────────────────────────────────────────────────────────────────────────────
// resolveWebDAV derives the shared-users WebDAV endpoint from cloudSyncConfig.
// Each provider stores its server location under a DIFFERENT key (nextcloudUrl /
// webdavUrl / none at all for Koofr), so a gate written against one provider's
// key silently disables the feature for the others — the lastGLANCE class-5
// bug family. These pin the per-provider shapes, especially Koofr's fixed root.
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveWebDAV', () => {
  it('returns null when sync is disabled, whatever else is set', () => {
    expect(resolveWebDAV({ enabled: false, provider: 'nextcloud', nextcloudUrl: 'https://nc.example.com', username: 'u', appPassword: 'p' })).toBeNull();
    expect(resolveWebDAV(null)).toBeNull();
    expect(resolveWebDAV(undefined)).toBeNull();
  });

  it('builds the Nextcloud files path (default provider when key is absent)', () => {
    const config = { enabled: true, nextcloudUrl: 'https://nc.example.com/', username: 'user@host', appPassword: 'p' };
    expect(resolveWebDAV(config)).toEqual({
      baseUrl: 'https://nc.example.com/remote.php/dav/files/user%40host',
      username: 'user@host',
      appPassword: 'p',
    });
    expect(resolveWebDAV({ ...config, provider: 'nextcloud' })).toEqual(resolveWebDAV(config));
  });

  it('returns null for a Nextcloud config missing any required field', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'nextcloud', username: 'u', appPassword: 'p' })).toBeNull();
    expect(resolveWebDAV({ enabled: true, provider: 'nextcloud', nextcloudUrl: 'https://nc', appPassword: 'p' })).toBeNull();
    expect(resolveWebDAV({ enabled: true, provider: 'nextcloud', nextcloudUrl: 'https://nc', username: 'u' })).toBeNull();
  });

  it('uses the fixed Koofr WebDAV root — Koofr configs carry no URL key', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'koofr', username: 'u@example.com', appPassword: 'p' })).toEqual({
      baseUrl: 'https://app.koofr.net/dav/Koofr',
      username: 'u@example.com',
      appPassword: 'p',
    });
  });

  it('returns null for a Koofr config missing credentials', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'koofr', username: 'u' })).toBeNull();
    expect(resolveWebDAV({ enabled: true, provider: 'koofr', appPassword: 'p' })).toBeNull();
  });

  it('uses webdavUrl for the generic webdav provider, stripping trailing slashes', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'webdav', webdavUrl: 'https://dav.example.com//', username: 'u', appPassword: 'p' })).toEqual({
      baseUrl: 'https://dav.example.com',
      username: 'u',
      appPassword: 'p',
    });
  });

  it('returns null for a generic config missing webdavUrl', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'webdav', username: 'u', appPassword: 'p' })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The roster over a Direct Access folder (docs/direct-access-sync.md, Phase 5):
// the iCloud roster sync over the transport's roster slot. The transport is a
// fake here; the real one is covered in sync/directAccessTransport.test.js.
// ─────────────────────────────────────────────────────────────────────────────

const u = (syncId, name, updatedAt, extra = {}) => ({ id: syncId, syncId, name, updatedAt, ...extra });

/** A fake transport over a shared "folder" so two devices can share one roster. */
const fakeFolder = () => ({ file: null });
const fakeTransport = (folder, { supported = true, roster = true, available = true, downloading = false, error = null } = {}) => ({
  isSupported: () => supported,
  rosterSupported: () => roster,
  isAvailable: () => available,
  rosterRead: vi.fn(async () => {
    if (error) return JSON.stringify({ error });
    if (downloading) return JSON.stringify({ downloading: true });
    return folder.file;
  }),
  rosterWrite: vi.fn(async (_path, text) => { folder.file = text; return true; }),
});

describe('reconcileRoster', () => {
  it('seeds from local when the file is absent, merges when it is there, and waits while it downloads', () => {
    const local = [u('a', 'Ann', '2026-10-01T00:00:00.000Z')];
    expect(reconcileRoster(null, local).merged).toEqual(local);
    expect(reconcileRoster('null', local).merged).toEqual(local);
    expect(reconcileRoster('{"downloading":true}', local)).toBeNull();
    const remote = JSON.stringify({ version: 1, users: [{ id: 'b', name: 'Bob', updatedAt: '2026-10-02T00:00:00.000Z' }] });
    const r = reconcileRoster(remote, local);
    expect(r.merged.map((x) => x.name).sort()).toEqual(['Ann', 'Bob']);
    expect(JSON.parse(r.body)).toMatchObject({ version: 1, users: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }] });
  });
});

describe('syncSharedUsersViaDirectAccess', () => {
  const ann = u('a', 'Ann', '2026-10-01T00:00:00.000Z');
  const bob = u('b', 'Bob', '2026-10-02T00:00:00.000Z');

  it('is null, and writes nothing, without a folder, without roster support, when unreachable, while downloading, or on an error', async () => {
    const folder = fakeFolder();
    for (const opts of [{ supported: false }, { roster: false }, { available: false }, { downloading: true }, { error: 'folder not found' }]) {
      const t = fakeTransport(folder, opts);
      expect(await syncSharedUsersViaDirectAccess(undefined, [ann], t)).toBeNull();
      expect(t.rosterWrite).not.toHaveBeenCalled();
    }
    expect(folder.file).toBeNull();
  });

  it('the first writer seeds the roster at the WebDAV path; the second merges last-writer-wins by updatedAt', async () => {
    const folder = fakeFolder();
    const first = fakeTransport(folder);
    expect(await syncSharedUsersViaDirectAccess(undefined, [ann], first)).toEqual([ann]);
    expect(first.rosterRead).toHaveBeenCalledWith('GLANCE/users/glance-users.json');
    expect(first.rosterWrite).toHaveBeenCalledWith('GLANCE/users/glance-users.json', expect.any(String));
    expect(JSON.parse(folder.file)).toMatchObject({ version: 1, users: [{ id: 'a', name: 'Ann' }] });

    // A custom usersPath lands where the WebDAV tier would put it.
    const custom = fakeTransport(fakeFolder());
    await syncSharedUsersViaDirectAccess('/Shared/Team/', [ann], custom);
    expect(custom.rosterRead).toHaveBeenCalledWith('Shared/Team/glance-users.json');

    // The second device knows Bob and an older Ann; the file's Ann is newer.
    const second = fakeTransport(folder);
    const merged = await syncSharedUsersViaDirectAccess(undefined, [u('a', 'Annie', '2026-09-01T00:00:00.000Z'), bob], second);
    expect(merged.find((x) => x.syncId === 'a').name).toBe('Ann');
    expect(merged.map((x) => x.syncId).sort()).toEqual(['a', 'b']);
    expect(JSON.parse(folder.file).users.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('a tombstoned user stays gone across devices', async () => {
    const folder = fakeFolder();
    folder.file = JSON.stringify({ version: 1, users: [{ id: 'b', name: 'Bob', updatedAt: '2026-10-03T00:00:00.000Z', deleted: true }] });
    const merged = await syncSharedUsersViaDirectAccess(undefined, [ann, bob], fakeTransport(folder));
    expect(merged.find((x) => x.syncId === 'b').deleted).toBe(true);
    expect(JSON.parse(folder.file).users.find((x) => x.id === 'b').deleted).toBe(true);
  });

  it('SCENARIO: two devices on one folder converge their rosters without the button', async () => {
    const folder = fakeFolder();
    const macA = fakeTransport(folder);
    const macB = fakeTransport(folder);
    let rosterA = [ann];
    let rosterB = [bob];
    rosterA = await syncSharedUsersViaDirectAccess(undefined, rosterA, macA);      // A seeds
    rosterB = await syncSharedUsersViaDirectAccess(undefined, rosterB, macB);      // B merges Ann in, writes both
    rosterA = await syncSharedUsersViaDirectAccess(undefined, rosterA, macA);      // A's next cycle picks Bob up
    expect(rosterA.map((x) => x.name).sort()).toEqual(['Ann', 'Bob']);
    expect(rosterB.map((x) => x.name).sort()).toEqual(['Ann', 'Bob']);
    expect(JSON.parse(folder.file).users.map((x) => x.name).sort()).toEqual(['Ann', 'Bob']);
  });
});
