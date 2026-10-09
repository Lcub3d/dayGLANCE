import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createDirectAccessStore } from './directAccessStore.js';

// ── Direct Access sync (Electron) ────────────────────────────────────────────
//
// The user picks a folder that a third-party tool (Google Drive for desktop,
// Dropbox, OneDrive, Syncthing, a network share) already keeps in step across
// devices; dayGLANCE reads and writes dayglance-sync.json inside it and the
// tool moves it. The renderer runs the same cycle it runs for iCloud
// (src/sync/snapshotFileSync.js) through src/sync/directAccessTransport.js.
//
// Folder access is held here, in the main process, for the same reason the
// Obsidian vault's is (electron/obsidian.ts): under the Mac App Store sandbox
// only a security-scoped bookmark obtained from the native dialog survives a
// relaunch, and only the process that resolved it can use it. On Windows and
// Linux a plain persisted path is used. The renderer never sees the path
// through the sync surface — only a folder name for the settings panel.
//
// All file I/O lives in directAccessStore.ts so it can be tested without
// Electron; this file is the dialog, the bookmark, the config and the IPC.

interface DirectAccessConfig { path: string; bookmark?: string; }

const store = createDirectAccessStore();
let stopAccessing: (() => void) | null = null;

function configPath(): string {
  return path.join(app.getPath('userData'), 'direct-access.json');
}

function loadConfig(): DirectAccessConfig | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as DirectAccessConfig;
    return cfg && typeof cfg.path === 'string' ? cfg : null;
  } catch { return null; }
}

function saveConfig(cfg: DirectAccessConfig): void {
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg)); } catch { /* ignore */ }
}

function clearConfig(): void {
  try { fs.unlinkSync(configPath()); } catch { /* ignore */ }
}

// Begin security-scoped access for a bookmark (MAS). Releases any prior access
// first. No-op without a bookmark (Developer ID build, Windows, Linux).
function beginAccess(bookmark: string | undefined): void {
  if (stopAccessing) { try { stopAccessing(); } catch { /* ignore */ } stopAccessing = null; }
  if (bookmark && typeof app.startAccessingSecurityScopedResource === 'function') {
    try { stopAccessing = app.startAccessingSecurityScopedResource(bookmark) as () => void; }
    catch { stopAccessing = null; }
  }
}

interface Status { configured: boolean; path: string | null; name: string | null; reachable: boolean; }

function status(): Status {
  const base = store.getBase();
  return {
    configured: !!base,
    path: base,
    name: base ? path.basename(base) : null,
    reachable: store.reachable(),
  };
}

export function registerDirectAccessHandlers(getWindow: () => BrowserWindow | null): void {
  const notifyChanged = () => {
    const win = getWindow();
    win?.webContents.send('direct-access:changed');
  };

  // Native folder picker. Persists the folder (and its bookmark on macOS) so
  // access survives relaunch. null if the user cancels.
  ipcMain.handle('direct-access:pick', async (event) => {
    const opts = {
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      securityScopedBookmarks: true,
      message: 'Select the folder dayGLANCE should sync through',
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const dir = result.filePaths[0];
    const bookmark = result.bookmarks?.[0];
    saveConfig({ path: dir, bookmark });
    beginAccess(bookmark);
    store.setBase(dir);
    store.startWatch(notifyChanged);
    return status();
  });

  // Re-open the previously picked folder on launch. The folder is kept even
  // when it is not reachable right now — a streaming tool that has not started
  // yet, an unmounted share — so the renderer can show it as connected but
  // unavailable, and reads report the folder error until it returns. Only an
  // explicit disconnect or a new pick drops it.
  ipcMain.handle('direct-access:restore', async () => {
    const cfg = loadConfig();
    if (!cfg) return status();
    beginAccess(cfg.bookmark);
    store.setBase(cfg.path);
    store.startWatch(notifyChanged);
    return status();
  });

  ipcMain.handle('direct-access:disconnect', async () => {
    store.stopWatch();
    store.setBase(null);
    if (stopAccessing) { try { stopAccessing(); } catch { /* ignore */ } stopAccessing = null; }
    clearConfig();
    return true;
  });

  ipcMain.handle('direct-access:status', async () => status());

  ipcMain.handle('direct-access:read', async () => store.read());

  ipcMain.handle('direct-access:write', async (_event, text: unknown) => {
    if (typeof text !== 'string') return false;
    return store.write(text);
  });

  ipcMain.handle('direct-access:delete', async () => store.remove());

  // Files by path, confined to the folder in the store (Phase 5: the household
  // roster; Phase 7: intents). The renderer sends paths relative to the folder.
  ipcMain.handle('direct-access:list-files', async (_event, rel: unknown) =>
    (typeof rel === 'string' ? store.listFiles(rel) : null));
  ipcMain.handle('direct-access:read-file', async (_event, rel: unknown) =>
    (typeof rel === 'string' ? store.readFile(rel) : { kind: 'error', error: 'bad path' }));
  ipcMain.handle('direct-access:write-file', async (_event, rel: unknown, text: unknown) =>
    (typeof rel === 'string' && typeof text === 'string' ? store.writeFile(rel, text) : false));
  ipcMain.handle('direct-access:delete-file', async (_event, rel: unknown) =>
    (typeof rel === 'string' ? store.deleteFile(rel) : false));
  ipcMain.handle('direct-access:make-dir', async (_event, rel: unknown) =>
    (typeof rel === 'string' ? store.makeDir(rel) : false));

  app.on('will-quit', () => { store.stopWatch(); });
}
