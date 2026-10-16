import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Cloud, Save, Trash2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { formatLocalizedDate } from '../utils/localeFormatting.js';

// The auto-backup history: local and remote backups, each with Restore (after
// a confirmation, since it replaces everything) and Delete. Shared by the
// mobile auto-backup dialog and Settings → Backup & Restore on desktop.
const AutoBackupHistory = () => {
  const { t } = useTranslation();
  const { borderClass, textPrimary, textSecondary, darkMode, hoverBg } = useDayPlannerCtx();
  const {
    autoBackupRestoreConfirm, setAutoBackupRestoreConfirm,
    autoBackupConfig, autoBackupHistory,
    restoreFromAutoBackup, restoreFromRemoteBackup,
    deleteLocalAutoBackup, deleteRemoteAutoBackup,
  } = useSyncCtx();
  const [localExpanded, setLocalExpanded] = useState(false);
  const [remoteExpanded, setRemoteExpanded] = useState(false);

  return (
    <div className="space-y-6">
      {/* Restore confirmation */}
      {autoBackupRestoreConfirm && (
        <div className={`p-4 rounded-lg border ${borderClass} ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
          <p className={`text-sm ${textPrimary} mb-3`}>
            {t('backup.autoRestoreWarning')}
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setAutoBackupRestoreConfirm(null)}
              className={`px-3 py-1.5 text-sm rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg}`}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                if (autoBackupRestoreConfirm.type === 'local') {
                  restoreFromAutoBackup(autoBackupRestoreConfirm.id);
                } else {
                  restoreFromRemoteBackup(autoBackupRestoreConfirm.filename);
                }
              }}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            >
              {t('common.restore')}
            </button>
          </div>
        </div>
      )}

      {/* Local Backups */}
      <div>
        <button
          onClick={() => setLocalExpanded(v => !v)}
          className={`w-full flex items-center gap-2 font-medium ${textPrimary} mb-2 hover:opacity-70 transition-opacity`}
        >
          {localExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Save size={14} />
          {t('backup.localBackups')} ({autoBackupHistory.local.length})
        </button>
        {localExpanded && (
          autoBackupHistory.local.length === 0 ? (
            <p className={`text-sm ${textSecondary} pl-6`}>{t('backup.noLocalBackups')}</p>
          ) : (
            <div className="space-y-1">
              {autoBackupHistory.local.map(b => (
                <div key={b.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${textPrimary} truncate`}>
                      {formatLocalizedDate(new Date(b.timestamp), { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                    <p className={`text-xs ${textSecondary}`}>{t(`backup.${b.frequency}`, { defaultValue: b.frequency })}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <button
                      onClick={() => setAutoBackupRestoreConfirm({ type: 'local', id: b.id, timestamp: b.timestamp })}
                      className={`p-1.5 rounded ${hoverBg}`}
                      title={t('common.restore')}
                    >
                      <Undo2 size={14} className={textSecondary} />
                    </button>
                    <button
                      onClick={() => deleteLocalAutoBackup(b.id)}
                      className={`p-1.5 rounded ${hoverBg}`}
                      title={t('common.delete')}
                    >
                      <Trash2 size={14} className={textSecondary} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Remote Backups */}
      {autoBackupConfig.remote.enabled && (
        <div>
          <button
            onClick={() => setRemoteExpanded(v => !v)}
            className={`w-full flex items-center gap-2 font-medium ${textPrimary} mb-2 hover:opacity-70 transition-opacity`}
          >
            {remoteExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Cloud size={14} />
            {t('backup.remoteBackups')} ({autoBackupHistory.remote.length})
          </button>
          {remoteExpanded && (
            autoBackupHistory.remote.length === 0 ? (
              <p className={`text-sm ${textSecondary} pl-6`}>{t('backup.noRemoteBackups')}</p>
            ) : (
              <div className="space-y-1">
                {autoBackupHistory.remote.map(b => (
                  <div key={b.filename} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${textPrimary} truncate`}>
                        {b.lastModified ? formatLocalizedDate(new Date(b.lastModified), { dateStyle: 'short', timeStyle: 'short' }) : b.filename}
                      </p>
                      <p className={`text-xs ${textSecondary} truncate`}>{b.filename}</p>
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      <button
                        onClick={() => setAutoBackupRestoreConfirm({ type: 'remote', filename: b.filename, timestamp: b.lastModified })}
                        className={`p-1.5 rounded ${hoverBg}`}
                        title={t('common.restore')}
                      >
                        <Undo2 size={14} className={textSecondary} />
                      </button>
                      <button
                        onClick={() => deleteRemoteAutoBackup(b.filename)}
                        className={`p-1.5 rounded ${hoverBg}`}
                        title={t('common.delete')}
                      >
                        <Trash2 size={14} className={textSecondary} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default AutoBackupHistory;
