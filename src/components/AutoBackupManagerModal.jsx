import React from 'react';
import { Clock, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';
import AutoBackupHistory from './AutoBackupHistory.jsx';
import { useTranslation } from 'react-i18next';

const AutoBackupManagerModal = () => {
  const { t } = useTranslation();
  const { cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg } = useDayPlannerCtx();
  const {
    showAutoBackupManager, setShowAutoBackupManager,
    setAutoBackupRestoreConfirm,
    autoBackupManagerTab, setAutoBackupManagerTab,
    autoBackupConfig, setAutoBackupConfig,
    autoBackupStatus,
    loadAutoBackupHistory, performRemoteBackup,
    folderBackup, restoreFromBackupFolder,
  } = useSyncCtx();

  if (!showAutoBackupManager) return null;

  return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => { setShowAutoBackupManager(false); setAutoBackupRestoreConfirm(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl ${borderClass} border max-w-lg w-full mx-4 max-h-[80vh] flex flex-col`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-6 pb-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                  <Clock size={20} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('backup.autoBackup')}</h3>
                <button onClick={() => { setShowAutoBackupManager(false); setAutoBackupRestoreConfirm(null); }} className={`ml-auto p-1 rounded ${hoverBg}`}>
                  <X size={18} className={textSecondary} />
                </button>
              </div>

              {/* Tabs */}
              <div className={`flex border-b ${borderClass}`}>
                <button
                  onClick={() => setAutoBackupManagerTab('settings')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    autoBackupManagerTab === 'settings'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : `border-transparent ${textSecondary} ${hoverBg}`
                  }`}
                >
                  {t('common.settings')}
                </button>
                <button
                  onClick={() => { setAutoBackupManagerTab('history'); loadAutoBackupHistory(); }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    autoBackupManagerTab === 'history'
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                      : `border-transparent ${textSecondary} ${hoverBg}`
                  }`}
                >
                  {t('backup.history')}
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 pb-6 overflow-y-auto flex-1">
              {autoBackupManagerTab === 'settings' ? (
                <AutoBackupSettingsForm
                  config={autoBackupConfig}
                  setConfig={setAutoBackupConfig}
                  status={autoBackupStatus}
                  darkMode={darkMode}
                  textPrimary={textPrimary}
                  textSecondary={textSecondary}
                  borderClass={borderClass}
                  hoverBg={hoverBg}
                  onRemoteBackupNow={performRemoteBackup}
                  folderBackup={folderBackup}
                  onFolderRestore={restoreFromBackupFolder}
                />
              ) : (
                <AutoBackupHistory />
              )}
            </div>
          </div>
        </div>
  );
};

export default AutoBackupManagerModal;
