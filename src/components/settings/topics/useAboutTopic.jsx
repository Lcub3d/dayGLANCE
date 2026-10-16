// Settings: the About & Help topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React from 'react';
import { AlertTriangle, ExternalLink, ListChecks, X } from 'lucide-react';
import HelpLinks from '../../HelpLinks.jsx';
import SettingsCard from '../SettingsCard.jsx';
import { getStorageUsage, formatBytes } from '../../../utils/storage.js';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../../../context/SyncContext.jsx';

export default function useAboutTopic() {
  const { t } = useTranslation();
  const {
    updateInfo, setUpdateInfo, setUpdateDismissedVersion, darkMode, textPrimary,
    textSecondary, borderClass, gettingStartedDismissed, setGettingStartedDismissed,
    setShowSettings,
  } = useDayPlannerCtx();
  const { setShowStorageBreakdown } = useSyncCtx();
  const updateVisible = !!updateInfo && !(typeof window !== 'undefined' && window.electronAPI?.isMAS === true);

  return {
    about: {
      show: true,
      attention: updateVisible ? 'red' : null,
      node: (
        <div className="space-y-5">
          {/* No heading of its own: the page is the section, and the phone's
              page title already names it. */}
          {updateVisible && (
              <div className={`p-3 rounded-lg border ${darkMode ? 'bg-blue-900/20 border-blue-800' : 'bg-blue-50 border-blue-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className={`text-sm font-medium ${darkMode ? 'text-blue-300' : 'text-blue-800'}`}>
                      {t('settings.updateAvailable', { version: updateInfo.latestVersion })}
                    </div>
                    <div className={`text-xs mt-1 ${darkMode ? 'text-blue-400/70' : 'text-blue-600/70'}`}>
                      {t('settings.updateCurrentVersion', { version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?' })}
                    </div>
                    <div className={`text-xs mt-2 space-y-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-700/80'}`}>
                      <div><strong>Vercel / Web:</strong> {t('settings.updateVercelHint')}</div>
                      <div><strong>Docker:</strong> <code className={`text-[11px] px-1 py-0.5 rounded ${darkMode ? 'bg-blue-900/50' : 'bg-blue-100'}`}>docker compose pull && docker compose up -d</code></div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <a
                        href={updateInfo.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-xs font-medium ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} flex items-center gap-1`}
                      >
                        <ExternalLink size={12} />
                        {t('settings.updateReleaseNotes')}
                      </a>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setUpdateDismissedVersion(updateInfo.latestVersion);
                      localStorage.setItem('dayglance-update-dismissed', updateInfo.latestVersion);
                      setUpdateInfo(null);
                    }}
                    className={`p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 flex-shrink-0`}
                    title={t('common.dismiss')}
                  >
                    <X size={14} className={darkMode ? 'text-blue-400' : 'text-blue-600'} />
                  </button>
                </div>
              </div>
          )}
          <p className={`text-sm ${textSecondary}`} data-about-version>
            {typeof __APP_VERSION__ !== 'undefined' ? `dayGLANCE v${__APP_VERSION__}` : 'dayGLANCE'}
            {typeof __BUILD_TIMESTAMP__ !== 'undefined' ? ` · ${new Date(__BUILD_TIMESTAMP__).toLocaleString()}` : ''}
          </p>
          <HelpLinks textSecondary={textSecondary} />
          {/* What the Help & Feedback dialog held besides the links: the
              Getting Started checklist's switch and local storage use. */}
          <SettingsCard
            cardId="gettingStarted"
            icon={ListChecks}
            title={t('app.gettingStartedChecklist')}
            hint={t('app.gettingStartedChecklistHint')}
            checked={!gettingStartedDismissed}
            onToggle={(on) => {
              if (on) {
                localStorage.removeItem('gettingStartedDismissed');
                setGettingStartedDismissed(false);
              } else {
                setGettingStartedDismissed(true);
              }
            }}
            darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
          />
          {(() => {
            const usage = getStorageUsage();
            const warn = usage.totalBytes > 4 * 1024 * 1024;
            return (
              <button
                type="button"
                data-about-storage
                onClick={() => { setShowSettings(false); setShowStorageBreakdown(true); }}
                className={`flex items-center gap-1.5 text-xs ${warn ? 'text-orange-500' : textSecondary} hover:opacity-75 transition-opacity`}
              >
                {warn && <AlertTriangle size={11} />}
                Local storage: {formatBytes(usage.totalBytes)} / ~5 MB
              </button>
            );
          })()}
        </div>
      ),
    },
  };
}
