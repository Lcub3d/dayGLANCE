import React, { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useDirectAccessStatus from '../hooks/useDirectAccessStatus.js';
import { directAccessTransport, DIRECT_ACCESS_LAST_SYNCED_KEY } from '../sync/directAccessTransport.js';

/**
 * Settings → Cloud Sync: the Direct Access card (docs/direct-access-sync.md).
 *
 * Desktop only (the Electron main process holds the folder). Shows the
 * connection, offers the native folder picker, and carries the per-device
 * on/off switch, which mirrors ICloudSyncToggle: turning it off is inert, not
 * destructive — the folder copy and the other devices are untouched.
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

  const pick = async () => {
    setBusy(true);
    try { await transport.pickFolder(); }
    finally { setBusy(false); }
  };
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

      {!status.connected ? (
        <div className="flex items-center justify-between gap-3">
          <p className={`text-xs ${textSecondary}`}>{t('directAccess.notConnected')}</p>
          <button type="button" onClick={pick} disabled={busy || status.status === 'unknown'} className={button}>
            {t('directAccess.chooseFolder')}
          </button>
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
              {t('directAccess.changeFolder')}
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
