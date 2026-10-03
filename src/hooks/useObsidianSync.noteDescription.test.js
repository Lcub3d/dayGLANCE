import { describe, it, expect, vi, afterEach } from 'vitest';

// THE DESCRIPTION SECTION and REFUSE ON CHANGE (owner ruling 2026-10-03).
// The hook's half: loadNoteDescription reads the section out of the note
// the task panel's reader returns; saveNoteDescription and saveWikiNote
// re-read before writing and refuse when the text moved since it was
// loaded; the intents carry the base so the applier can tell too.
// Capture-harness pattern (useObsidianSync.wikiNoteCreate.test.js).

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const readWikiNote = vi.fn();
const writeWikiNote = vi.fn(async () => {});
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
  probeVaultAccess: vi.fn(async () => 'ok'),
  getVaultAccess: vi.fn(async () => null),
  syncObsidianVault: vi.fn(async () => null),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: vi.fn(async () => false),
  writeTaskStateNative: vi.fn(() => false),
  simpleHash: vi.fn(() => 'h'),
  deriveBlockId: vi.fn(() => 'testblok0'),
  appIdForBlockId: vi.fn((b) => `obsidian-dg-${b}`),
  readWikiNote: (...a) => readWikiNote(...a),
  writeWikiNote: (...a) => writeWikiNote(...a),
  scanVaultNotes: vi.fn(async () => ({ names: [], unportable: [] })),
  OBSIDIAN_IMPORT_WINDOW_DAYS: 90,
  dailyNoteFilename: (dateStr) => `${dateStr}.md`,
  obsidianWindowCutoffDate: vi.fn(() => null),
}));
vi.mock('../native.js', () => ({
  isNativeAndroid: () => false,
  isNativeApp: () => false,
  nativeGetVaultConfig: vi.fn(() => null),
  nativeGetNote: vi.fn(() => null),
  nativeWriteNote: vi.fn(),
  nativeOpenNote: vi.fn(),
  nativeListNotes: vi.fn(() => []),
  nativeSetVaultSettings: vi.fn(),
  nativeSetLaunchOnWrite: vi.fn(),
}));
const emitBridgeIntent = vi.fn(() => true);
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  cachedBridgePairingMeta: () => null,
  emitBridgeIntent: (...a) => emitBridgeIntent(...a),
  flushBridgeOutbox: vi.fn(async () => true),
  publishBridgeConfig: vi.fn(async () => {}),
  getBridgePairingMeta: vi.fn(async () => null),
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');
const { noteTextHash } = await import('@glance-apps/obsidian-format');

const NOTE = '---\ncreated: 2026-10-03\nsource: dayGLANCE\n---\n# House\nDry roof by spring.\n\n## Tasks\n- [ ] Fix the gutter ^dg-abc12345\n';

function useMountedSync({ stream = true, projects = [], enabled = true } = {}) {
  effects.length = 0;
  vi.stubGlobal('setTimeout', () => 1);
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', {});
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  const updateProject = vi.fn((id, u) => { const p = projects.find((x) => x.id === id); if (p) Object.assign(p, u); });
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: [], setTasks: vi.fn(), unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd', newNotesFolder: 'dayGLANCE' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null, obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(), setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: { kind: 'directory' } },
    obsidianSyncInProgressRef: { current: false }, obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: [] }, obsidianInboxRef: { current: [] },
    projects, goals: [], updateProject, updateGoal: vi.fn(),
  });
  api.bridgeHeartbeatRef.current = { obsidianRunning: stream, pluginAuthoritative: stream, vaultPosture: stream ? 'plugin' : 'direct' };
  return { ...api, updateProject, store };
}
const flushMicrotasks = () => new Promise((r) => setImmediate(r));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); readWikiNote.mockReset(); writeWikiNote.mockClear(); emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true); });

describe('loadNoteDescription', () => {
  it('returns the section under the title with its hash; absence and an unreadable vault pass through', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: 'L' });
    const { loadNoteDescription } = useMountedSync();
    await expect(loadNoteDescription('Projects/House.md')).resolves.toEqual({ text: 'Dry roof by spring.', base: noteTextHash('Dry roof by spring.'), lastModified: 'L' });
    readWikiNote.mockResolvedValue(null);
    await expect(loadNoteDescription('Projects/House.md')).resolves.toEqual({ notFound: true });
    readWikiNote.mockRejectedValue(new Error('boom'));
    await expect(loadNoteDescription('Projects/House.md')).resolves.toBe(null);
  });
});

describe('saveNoteDescription (the editor over the section)', () => {
  it('writes the section as a replace intent carrying the base, when the section is as loaded', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: 'L' });
    const { saveNoteDescription } = useMountedSync();
    const base = noteTextHash('Dry roof by spring.');
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Dry roof, and gutters.', { base })).resolves.toEqual({ ok: true });
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_description', expect.objectContaining({
      path: 'Projects/House.md', targetId: 'p1', content: 'Dry roof, and gutters.', mode: 'replace', base,
    }));
  });
  it('REFUSES when the section moved since it was loaded: nothing is sent, the current text comes back', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE.replace('Dry roof by spring.', 'Edited in Obsidian.'), lastModified: 'L2' });
    const { saveNoteDescription } = useMountedSync();
    const stale = noteTextHash('Dry roof by spring.');
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Typed here.', { base: stale }))
      .resolves.toEqual({ refused: 'changed', text: 'Edited in Obsidian.', lastModified: 'L2' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
  });
  it('direct access writes the whole note with the section replaced', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: 'L' });
    const { saveNoteDescription } = useMountedSync({ stream: false });
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'New text.')).resolves.toEqual({ ok: true });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    expect(writeWikiNote).toHaveBeenCalledWith({ kind: 'directory' }, 'Projects/House.md', NOTE.replace('Dry roof by spring.', 'New text.'), 'dayGLANCE');
  });
});

describe('saveWikiNote refuses on change too (task notes)', () => {
  it('a base that no longer matches the note refuses; a matching one writes with the base on the intent', async () => {
    readWikiNote.mockResolvedValue({ text: 'moved', lastModified: 'L' });
    const { saveWikiNote } = useMountedSync();
    await expect(saveWikiNote('TV Series', 'mine', { base: noteTextHash('loaded') })).resolves.toEqual({ refused: 'changed', text: 'moved', lastModified: 'L' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    await saveWikiNote('TV Series', 'mine', { base: noteTextHash('moved') });
    expect(emitBridgeIntent).toHaveBeenCalledWith('wiki_note_write', expect.objectContaining({ noteName: 'TV Series', content: 'mine', base: noteTextHash('moved') }));
    // Without a base: the old behaviour, no read, no refusal.
    emitBridgeIntent.mockClear(); readWikiNote.mockClear();
    await saveWikiNote('TV Series', 'again');
    expect(readWikiNote).not.toHaveBeenCalled();
    expect(emitBridgeIntent).toHaveBeenCalledWith('wiki_note_write', expect.not.objectContaining({ base: expect.anything() }));
  });
});

describe('the notes box moves into the note', () => {
  it('on link: merged below the note, journaled, the record emptied on enqueue', async () => {
    const projects = [{ id: 'p1', title: 'House', description: 'Purpose: keep it dry.' }];
    const { linkProjectNote, updateProject, store } = useMountedSync({ projects });
    expect(linkProjectNote('project', 'p1', 'Projects/House.md')).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_description', { path: 'Projects/House.md', targetId: 'p1', content: 'Purpose: keep it dry.', mode: 'merge' });
    expect(updateProject).toHaveBeenCalledWith('p1', { description: '' });
    expect(JSON.parse(store.get('day-planner-obsidian-notes-sent'))['project:p1']).toMatchObject({ target: 'Projects/House.md', body: 'Purpose: keep it dry.' });
  });
  it('on link of an entity not yet in the lists: the body travels with the call', () => {
    const { linkProjectNote, updateProject } = useMountedSync({ projects: [] });
    expect(linkProjectNote('project', 'p9', 'Projects/New.md', { description: 'Fresh.' })).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_description', { path: 'Projects/New.md', targetId: 'p9', content: 'Fresh.', mode: 'merge' });
    expect(updateProject).toHaveBeenCalledWith('p9', { description: '' });
  });
  it('at creation: rides the create intent as description, journaled, the record emptied', () => {
    const projects = [{ id: 'p2', title: 'Garden', description: 'Grow food.' }];
    const { createProjectNote, updateProject } = useMountedSync({ projects });
    expect(createProjectNote('project', 'p2', { title: 'Garden', description: 'Grow food.' })).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_create', expect.objectContaining({ targetId: 'p2', description: 'Grow food.' }));
    expect(updateProject).toHaveBeenCalledWith('p2', { description: '' });
    // A refused enqueue leaves the box where it was.
    emitBridgeIntent.mockReturnValue(false);
    updateProject.mockClear();
    expect(createProjectNote('project', 'p2', { title: 'Garden', description: 'Grow food.' })).toBe(false);
    expect(updateProject).not.toHaveBeenCalled();
  });
});

describe('the link without a stream (owner 2026-10-03: the wikilink in the title, and the note row, on direct access)', () => {
  it('a refused enqueue with the vault enabled links the record alone, marked pending; the stream path clears the mark', () => {
    emitBridgeIntent.mockReturnValue(false);
    const projects = [{ id: 'p1', title: 'House' }];
    const { linkProjectNote, updateProject } = useMountedSync({ stream: false, projects });
    expect(linkProjectNote('project', 'p1', '[[Projects/House]]')).toBe(true);
    expect(updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null, obsidianNoteLinkPending: expect.stringMatching(/^\d{4}-/) });
    // With the stream the key goes out and the record carries no mark.
    emitBridgeIntent.mockReturnValue(true);
    updateProject.mockClear();
    expect(linkProjectNote('project', 'p1', 'Projects/House.md')).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_link', { path: 'Projects/House.md', targetId: 'p1' });
    expect(updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null, obsidianNoteLinkPending: null });
  });
  it('with the vault disabled a refused enqueue is a refusal, as before', () => {
    emitBridgeIntent.mockReturnValue(false);
    const projects = [{ id: 'p1', title: 'House' }];
    const { linkProjectNote, updateProject } = useMountedSync({ stream: false, projects, enabled: false });
    expect(linkProjectNote('project', 'p1', 'Projects/House.md')).toBe(false);
    expect(updateProject).not.toHaveBeenCalled();
  });
  it('the notes box moves into the section through the direct write: merged below the note\'s text, journaled, the record emptied once the write landed', async () => {
    emitBridgeIntent.mockReturnValue(false);
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: 'L' });
    const projects = [{ id: 'p1', title: 'House', description: 'Purpose: keep it dry.' }];
    const { linkProjectNote, updateProject, store } = useMountedSync({ stream: false, projects });
    expect(linkProjectNote('project', 'p1', 'Projects/House.md')).toBe(true);
    await flushMicrotasks();
    expect(writeWikiNote).toHaveBeenCalledWith({ kind: 'directory' }, 'Projects/House.md', NOTE.replace('Dry roof by spring.', 'Dry roof by spring.\n\nPurpose: keep it dry.'), 'dayGLANCE');
    expect(updateProject).toHaveBeenCalledWith('p1', { description: '' });
    expect(JSON.parse(store.get('day-planner-obsidian-notes-sent'))['project:p1']).toMatchObject({ target: 'Projects/House.md', body: 'Purpose: keep it dry.' });
  });
  it('a note this device cannot find leaves the box on the record for the first pass that can move it', async () => {
    emitBridgeIntent.mockReturnValue(false);
    readWikiNote.mockResolvedValue(null);
    const projects = [{ id: 'p1', title: 'House', description: 'Purpose: keep it dry.' }];
    const { linkProjectNote, updateProject } = useMountedSync({ stream: false, projects });
    expect(linkProjectNote('project', 'p1', 'Projects/Typo.md')).toBe(true);
    await flushMicrotasks();
    expect(writeWikiNote).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalledWith('p1', { description: '' });
    expect(projects[0].description).toBe('Purpose: keep it dry.');
  });
  it('unlinking a pending link clears the record and sends no unlink: the vault never carried the key', () => {
    const projects = [{ id: 'p1', title: 'House', obsidianNotePath: 'Projects/House.md', obsidianNoteLinkPending: '2026-10-03T10:00:00.000Z' }];
    const { unlinkProjectNote, updateProject } = useMountedSync({ projects });
    expect(unlinkProjectNote('project', 'p1')).toBe(true);
    expect(updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: null, obsidianNoteMissingAt: null, obsidianNoteLinkPending: null });
    expect(emitBridgeIntent).not.toHaveBeenCalledWith('project_note_unlink', expect.anything());
  });
});
