// Settings: the Backup & Restore topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React from 'react';
import BackupSettings from '../../BackupSettings.jsx';

export default function useBackupTopic() {
  return {
    backup: {
      show: true,
      node: <BackupSettings />,
    },
  };
}
