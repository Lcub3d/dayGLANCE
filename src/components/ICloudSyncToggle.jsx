import React, { useState } from 'react';
import { CloudCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsCard from './settings/SettingsCard.jsx';
import { isICloudSyncEnabled, setICloudSyncEnabled } from '../utils/icloudSyncPref.js';

/**
 * On/off switch for this device's iCloud sync.
 *
 * Two reasons it exists rather than leaving iCloud purely zero-config:
 *
 *  1. It makes the first-run "start fresh on this device" choice reversible. That
 *     choice writes the same preference this reads, so a user who declined the
 *     restore has somewhere to change their mind.
 *  2. macOS has no alternative. electron/icloud.ts resolves the container by raw
 *     filesystem path and never registers with the iCloud daemon, so the Mac app
 *     never appears under "Apps syncing to iCloud Drive" and System Settings
 *     offers no way to stop it. This is the only off switch that platform has.
 *
 * Default stays ON: the preference is tri-state and absence means enabled, so
 * existing users are unaffected and zero-config still holds.
 *
 * Turning it off is inert, not destructive — the container copy stays where it is
 * and other devices keep syncing. Turning it back on resumes on the next cycle,
 * which will merge whatever the cloud copy now holds.
 */
const ICloudSyncToggle = ({ darkMode, textPrimary, textSecondary, borderClass }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => isICloudSyncEnabled());

  const toggle = () => {
    const next = !enabled;
    setICloudSyncEnabled(next);
    setEnabled(next);
  };

  // A Settings card like every other channel (docs/settings-redesign.md):
  // the switch in its title row, what on or off means under it.
  return (
    <SettingsCard
      cardId="icloudSync"
      icon={CloudCog}
      title={t('icloudSync.title')}
      hint={enabled ? t('icloudSync.onHint') : t('icloudSync.offHint')}
      checked={enabled}
      onToggle={toggle}
      darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
    />
  );
};

export default ICloudSyncToggle;
