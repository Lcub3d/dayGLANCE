// Headless refresh (docs/launcher-integration.md, "Freshness"; CLAUDE.md,
// "Headless refresh"): the Android shell loads the same bundle in a WebView
// with no Activity, with `?headless=refresh&clientId=…`, to run one sync
// cycle and re-push the launcher snapshot while the app's process is dead.
// main.jsx mounts src/headless/HeadlessRefresh.jsx instead of App for it.
//
// The query is read once, like the tray's (utils/trayMode.js): it cannot
// change without a reload.

export const HEADLESS_PARAM = 'headless';
export const HEADLESS_REFRESH = 'refresh';

/** The headless request in a query string, or null when this is the app. */
export const headlessRequest = (search) => {
  const params = new URLSearchParams(search ?? '');
  if (params.get(HEADLESS_PARAM) !== HEADLESS_REFRESH) return null;
  return { clientId: params.get('clientId') || '' };
};

export const isHeadlessRefresh = () =>
  typeof window !== 'undefined' && headlessRequest(window.location?.search ?? '') !== null;

/**
 * The native bridge methods a headless run may call: the allowlist the
 * shell's HeadlessBridge implements under `window.DayGlanceNative`, and
 * nothing more. Everything else on the full bridge is absent there, so a
 * feature that reached for it would find no method rather than a native
 * side effect. The scenario tests hold the root to this list.
 */
export const HEADLESS_BRIDGE_METHODS = Object.freeze([
  // The sync transports (native.js, nativeHttpRequest).
  'httpRequest', 'httpRequestAsync', 'supportsAsyncHttp',
  // The sync keys, wrapped in the Android Keystore (sync/dbEngine.js, utils/crypto.js).
  'getSyncKey', 'storeSyncKey', 'getSyncKeyForSlot', 'storeSyncKeyForSlot',
  // Capability probes the sync layer reads; the shell answers "unsupported".
  'isVaultSseSupported',
  // The launcher's read model and freshness (docs/launcher-integration.md).
  'updateLauncherSnapshot', 'touchLauncherHeartbeat', 'recordLauncherRefresh',
  // The run's own protocol with the worker.
  'headlessShouldAbort', 'headlessDone',
]);

/** The outcomes a headless run reports through `headlessDone`. */
export const HEADLESS_OUTCOMES = Object.freeze({
  RAN: 'ran',
  FAILED: 'failed',
  /** The app opened during the run: the live instance takes over (the reverse lock). */
  ABORTED: 'aborted',
});
