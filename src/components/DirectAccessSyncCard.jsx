import React, { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useDirectAccessStatus from '../hooks/useDirectAccessStatus.js';
import { isNativeAndroid, isNativeIOS } from '../native.js';
import { directAccessTransport, DIRECT_ACCESS_LAST_SYNCED_KEY } from '../sync/directAccessTransport.js';

/**
 * Settings → Cloud Sync: the Direct Access card (docs/direct-access-sync.md).
 *
 * Shows the connection, offers the native picker (a folder on desktop and
 * Android, the sync file itself on iPhone and iPad), and carries the
 * per-device on/off switch, which mirrors ICloudSyncToggle: turning it off is
 * inert, not destructive — the shared copy and the other devices are untouched.
 */
const DirectAccessSyncCard = ({ darkMode, textPrimary, textSecondary, borderClass, transport = directAccessTransport }) => {
  const { t } = useTranslation();
  const status = useDirectAccessStatus(transport);
  const [busy, setBusy] = useState(false);

  // The cycle stamps this on every real read; re-read it while the card is open.
  const readLastSynced = () => {
    try { return localStorage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY); } catch { return null; }
  };
  const [lastSynced, setLastSynced] = useState(readLastSynced);
  useEffect(() => {
    setLastSynced(readLastSynced());
    const timer = setInterval(() => setLastSynced(readLastSynced()), 15 * 1000);
    return () => clearInterval(timer);
  }, [status.status]);

  // On iPhone and iPad the bookmark is of the sync file, not the folder: the
  // Files providers (Nextcloud, Drive, Dropbox) cannot hand over a folder
  // (DirectAccessBridge.swift). So the card offers the file: pick the one a
  // device already seeded, or create it in a folder for a first device.
  const ios = isNativeIOS();
  const run = (fn) => async () => {
    setBusy(true);
    try { await fn(); }
    finally { setBusy(false); }
  };
  const pick = run(() => (ios ? transport.pickFile() : transport.pickFolder()));
  const create = run(() => transport.createFile());
  const disconnect = async () => {
    setBusy(true);
    try { await transport.disconnect(); }
    finally { setBusy(false); }
  };
  const toggle = () => transport.setEnabled(!status.enabled);

  const button = `px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${textPrimary} disabled:opacity-50`;

  return (
    <div className={`rounded-lg border ${borderClass} p-3 space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${textPrimary} flex items-center gap-2`}>
            <FolderOpen size={14} className={textSecondary} />
            {t('directAccess.title')}
          </p>
          <p className={`text-xs ${textSecondary}`}>{t('directAccess.desc')}</p>
          {/* The Google Drive and Dropbox apps do not offer a folder tree to the
              Android picker; only an app that mirrors to local storage works. */}
          {isNativeAndroid() && (
            <p className={`text-xs ${textSecondary} mt-1`}>{t('directAccess.androidHint')}</p>
          )}
          {isNativeIOS() && (
            <p className={`text-xs ${textSecondary} mt-1`}>{t('directAccess.iosHint')}</p>
          )}
        </div>
        {status.connected && (
          <button
            type="button"
            onClick={toggle}
            role="switch"
            aria-checked={status.enabled}
            aria-label={t('directAccess.title')}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
              status.enabled ? 'bg-green-500' : darkMode ? 'bg-gray-600' : 'bg-stone-300'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                status.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        )}
      </div>

      {/* Why the last pick failed, from the shell (no bookmark, no result).
          Without this a failed pick looked exactly like a cancelled one. */}
      {status.pickError && (
        <p className="text-xs text-red-700 dark:text-red-300 break-words">
          {t('directAccess.pickFailed', { reason: status.pickError })}
        </p>
      )}
      {!status.connected ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className={`text-xs ${textSecondary}`}>{ios ? t('directAccess.notConnectedFile') : t('directAccess.notConnected')}</p>
          <div className="flex gap-2">
            <button type="button" onClick={pick} disabled={busy || status.status === 'unknown'} className={button}>
              {ios ? t('directAccess.chooseFile') : t('directAccess.chooseFolder')}
            </button>
            {ios && (
              <button type="button" onClick={create} disabled={busy || status.status === 'unknown'} className={button}>
                {t('directAccess.createFile')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0">
            <p className={`text-sm ${textPrimary} truncate`} title={status.path ?? undefined}>
              {t('directAccess.connectedTo')} <span className="font-medium">{status.name}</span>
            </p>
            {status.status === 'unreachable' ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t('directAccess.unreachable')}</p>
            ) : (
              <p className={`text-xs ${textSecondary}`}>
                {status.enabled ? t('directAccess.onHint') : t('directAccess.offHint')}
              </p>
            )}
            <p className={`text-xs ${textSecondary}`}>
              {lastSynced
                ? `${t('common.lastSynced')}: ${new Date(lastSynced).toLocaleString()}`
                : t('directAccess.neverSynced')}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={pick} disabled={busy} className={button}>
              {ios ? t('directAccess.changeFile') : t('directAccess.changeFolder')}
            </button>
            <button type="button" onClick={disconnect} disabled={busy} className={button}>
              {t('directAccess.disconnect')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default DirectAccessSyncCard;
