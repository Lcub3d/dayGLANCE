import React, { useEffect } from 'react';
import { Clock, History, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import ResetAppDataSection from './ResetAppDataSection.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';
import AutoBackupHistory from './AutoBackupHistory.jsx';
import SettingsCard from './settings/SettingsCard.jsx';

// Settings → Backup & Restore (#2075, docs/settings-redesign.md): export and
// restore, then Auto-Backup as cards (one per destination, each with its own
// switch, and the backup history), then reset. On desktop this replaces the
// auto-backup dialog; mobile still opens the dialog, which shares the same
// form and history. The restore confirmation opens above Settings.
const BackupSettings = () => {
  const { borderClass, textPrimary, textSecondary, darkMode, hoverBg } = useDayPlannerCtx();
  const {
    autoBackupConfig, setAutoBackupConfig, autoBackupStatus,
    performRemoteBackup, folderBackup, restoreFromBackupFolder,
    loadAutoBackupHistory, exportBackup, handleBackupFileSelect,
  } = useSyncCtx();

  const { t } = useTranslation();

  // The history card lists what is there now: loaded when the page opens, as
  // the dialog's History tab was, and again whenever a new backup lands while
  // it is open.
  const lastLocal = autoBackupStatus?.local?.lastBackup;
  const lastRemote = autoBackupStatus?.remote?.lastBackup;
  useEffect(() => { loadAutoBackupHistory?.(); }, [lastLocal, lastRemote]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
          <div>
            <p className={`${textSecondary} mb-4`}>
              {t('backup.description')}
            </p>
            <div className="space-y-3">
              <button
                onClick={() => exportBackup()}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium flex items-center gap-2">
                  <Upload size={16} className="rotate-180" />
                  {t('backup.exportBackup')}
                </div>
                <div className={`text-sm ${textSecondary}`}>{t('backup.exportHint')}</div>
              </button>
              <label className={`block w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors cursor-pointer`}>
                <div className="font-medium flex items-center gap-2">
                  <Upload size={16} />
                  {t('backup.restoreBackup')}
                </div>
                <div className={`text-sm ${textSecondary}`}>{t('backup.restoreHint')}</div>
                <input type="file" accept=".json" onChange={handleBackupFileSelect} className="hidden" />
              </label>
              {/* Auto-Backup: what was its own dialog, as cards on this page. */}
              <div className="pt-3 space-y-3" data-settings-group="autoBackup">
                <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                  <Clock size={16} className={textSecondary} />
                  {t('backup.autoBackup')}
                </h4>
                <p className={`text-xs ${textSecondary}`}>{t('backup.autoBackupHint')}</p>
                <AutoBackupSettingsForm
                  variant="cards"
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
                <SettingsCard
                  cardId="backupHistory"
                  icon={History}
                  title={t('backup.historyTitle')}
                  darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
                >
                  <AutoBackupHistory />
                </SettingsCard>
              </div>
              {/* Reset sits under the backup actions on purpose: exporting first
                  is the adjacent, obvious step before wiping everything. */}
              <ResetAppDataSection
                darkMode={darkMode}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
                onExportBackup={exportBackup}
              />
            </div>
          </div>
  );
};

export default BackupSettings;
