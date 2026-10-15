import React from 'react';
import { Clock, Save, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import ResetAppDataSection from './ResetAppDataSection.jsx';

// Settings → Backup & Restore (#2075, docs/settings-redesign.md). The content
// of what was the header save icon's dialog, unchanged but for the dialog's own
// Cancel and close-before-opening steps: the Settings page frames it now, and
// the auto-backup manager and the restore confirmation open above Settings.
const BackupSettings = () => {
  const { cardBg, borderClass, textPrimary, textSecondary, darkMode } = useDayPlannerCtx();
  const {
    autoBackupConfig, setAutoBackupManagerTab, setShowAutoBackupManager,
    exportBackup, handleBackupFileSelect,
  } = useSyncCtx();

  const { t } = useTranslation();

  return (
          <div>
            <h4 className={`font-medium ${textPrimary} flex items-center gap-2 mb-3`}>
              <Save size={16} className={textSecondary} />
              {t('backup.title')}
            </h4>
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
              <button
                onClick={() => { setAutoBackupManagerTab('settings'); setShowAutoBackupManager(true); }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium flex items-center gap-2">
                  <Clock size={16} />
                  {t('backup.autoBackup')}
                  {(autoBackupConfig.local.enabled || autoBackupConfig.remote.enabled) && (
                    <span className="ml-auto text-xs px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">{t('backup.activeLabel')}</span>
                  )}
                </div>
                <div className={`text-sm ${textSecondary}`}>{t('backup.autoBackupHint')}</div>
              </button>
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
