import React, { useEffect, useState } from 'react';
import { Clock, History, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import ResetAppDataSection from './ResetAppDataSection.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';
import AutoBackupHistory from './AutoBackupHistory.jsx';
import SettingsCard from './settings/SettingsCard.jsx';

// Settings → Backup & Restore (#2075, docs/settings-redesign.md): Auto-Backup
// as one card (its destinations, each with its own switch, and the backup
// history as cards inside it), then export, restore and reset as one row. On desktop this replaces the
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

  const [resetOpen, setResetOpen] = useState(false);
  const autoBackupActive = !!(autoBackupConfig?.local?.enabled || autoBackupConfig?.remote?.enabled
    || (autoBackupConfig?.folder?.enabled && folderBackup?.folderName));
  const actionClass = `flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'}`;

  return (
    <div className="space-y-6">
      {/* Auto-Backup: one card, its destinations and history cards inside. */}
      <SettingsCard
        cardId="autoBackup"
        icon={Clock}
        title={t('backup.autoBackup')}
        hint={t('backup.autoBackupHint')}
        badge={autoBackupActive ? <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">{t('backup.activeLabel')}</span> : null}
        darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
      >
        <div className="space-y-3">
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
      </SettingsCard>

      {/* Export, restore and reset: one row of actions under the cards. Reset
          opens its own panel below the row, which still asks for scope and a
          confirmation before anything is deleted. */}
      <div className="space-y-3" data-backup-actions>
        <p className={`text-xs ${textSecondary}`}>{t('backup.description')}</p>
        <div className="grid grid-cols-3 gap-3">
          <button type="button" onClick={() => exportBackup()} title={t('backup.exportHint')} className={`${actionClass} ${textPrimary}`} data-backup-action="export">
            <Upload size={16} className="rotate-180 flex-shrink-0" />
            <span className="truncate">{t('backup.exportBackup')}</span>
          </button>
          <label title={t('backup.restoreHint')} className={`${actionClass} ${textPrimary} cursor-pointer`} data-backup-action="restore">
            <Upload size={16} className="flex-shrink-0" />
            <span className="truncate">{t('backup.restoreBackup')}</span>
            <input type="file" accept=".json" onChange={handleBackupFileSelect} className="hidden" />
          </label>
          <button type="button" onClick={() => setResetOpen(true)} title={t('reset.subtitle')} className={`${actionClass} text-red-600 dark:text-red-400`} data-backup-action="reset">
            <Trash2 size={16} className="flex-shrink-0" />
            <span className="truncate">{t('reset.title')}</span>
          </button>
        </div>
        {resetOpen && (
          <ResetAppDataSection
            startExpanded
            onCollapse={() => setResetOpen(false)}
            darkMode={darkMode}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            onExportBackup={exportBackup}
          />
        )}
      </div>
    </div>
  );
};

export default BackupSettings;
