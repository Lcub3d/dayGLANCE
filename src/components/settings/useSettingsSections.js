// Every Settings section on this device, from each topic's own file under
// topics/ (docs/settings-redesign.md). The desktop dialog and the mobile
// Settings tab both read them, so a setting has one implementation.
//
// The hooks run whichever topic is open, so the topic list, its dots and
// search see every section, and a form's unsaved edits survive switching
// topics. The one state two topics share, the GLANCE apps WebDAV form, is
// held here once.
import useGeneralTopic from './topics/useGeneralTopic.jsx';
import useAppearanceTopic from './topics/useAppearanceTopic.jsx';
import useFeaturesTopic from './topics/useFeaturesTopic.jsx';
import useAiTopic from './topics/useAiTopic.jsx';
import useSyncTopic from './topics/useSyncTopic.jsx';
import useIntegrationsTopic, { useIntentForm } from './topics/useIntegrationsTopic.jsx';
import useNotificationsTopic from './topics/useNotificationsTopic.jsx';
import useBackupTopic from './topics/useBackupTopic.jsx';
import useAboutTopic from './topics/useAboutTopic.jsx';

export default function useSettingsSections() {
  const [intentForm, setIntentForm] = useIntentForm();
  return {
    ...useGeneralTopic(),
    ...useAppearanceTopic(),
    ...useFeaturesTopic({ intentForm }),
    ...useAiTopic(),
    ...useSyncTopic(),
    ...useIntegrationsTopic({ intentForm, setIntentForm }),
    ...useNotificationsTopic(),
    ...useBackupTopic(),
    ...useAboutTopic(),
  };
}
