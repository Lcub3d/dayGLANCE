// Where to find help: the docs, how to reach us, and the legal pages. Shared
// by the header's Help & Feedback dialog and Settings → About & Help (#2075),
// so the two cannot drift apart.
import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function HelpLinks({ textSecondary }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5" data-help-links>
      {/* Docs */}
      <div>
        <p className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} mb-2`}>{t('app.documentation')}</p>
        <a
          href="https://docs.dayglance.app"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors text-sm font-medium"
        >
          <ExternalLink size={14} />
          docs.dayglance.app
        </a>
      </div>

      {/* Contact */}
      <div>
        <p className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} mb-2`}>{t('app.contactIssues')}</p>
        <a
          href="mailto:support@glance-apps.com"
          className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors text-sm font-medium"
        >
          <ExternalLink size={14} />
          support@glance-apps.com
        </a>
        <a
          href="https://github.com/krelltunez/dayGLANCE/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors text-sm font-medium mt-1.5"
        >
          <ExternalLink size={14} />
          Report an issue on GitHub
        </a>
      </div>

      {/* Legal */}
      <div>
        <p className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} mb-2`}>{t('app.legal')}</p>
        <a
          href="https://www.glance-apps.com/dayglance/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors text-sm font-medium"
        >
          <ExternalLink size={14} />
          {t('onboarding.privacyPolicy')}
        </a>
        <a
          href="https://www.glance-apps.com/eula"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors text-sm font-medium mt-1.5"
        >
          <ExternalLink size={14} />
          {t('onboarding.termsOfUse')}
        </a>
      </div>
    </div>
  );
}
