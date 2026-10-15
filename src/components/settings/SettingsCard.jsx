// The Settings card (docs/settings-redesign.md, "The card pattern"): a title,
// its own switch, and its settings only while the switch is on. Off shows the
// title, the switch and a one-line summary, so a page of cards stays short and
// shows at a glance what is on.
import React from 'react';

export default function SettingsCard({
  icon: Icon, title, checked, onToggle, switchLabel, hint, summary, badge, darkMode,
  textPrimary, textSecondary, borderClass, children, cardId,
}) {
  return (
    <section
      data-settings-card={cardId}
      data-settings-card-state={checked ? 'on' : 'off'}
      className={`rounded-xl border ${borderClass} p-4 space-y-3`}
    >
      <div className="flex items-start gap-3">
        {Icon && <Icon size={18} className={`${textSecondary} flex-shrink-0 mt-0.5`} />}
        <div className="flex-1 min-w-0">
          <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
            <span className="truncate">{title}</span>
            {badge}
          </div>
          {hint && <p className={`text-xs ${textSecondary} mt-0.5`}>{hint}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!checked}
          aria-label={switchLabel || title}
          data-settings-card-switch
          onClick={() => onToggle(!checked)}
          className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-5' : 'left-1'}`} />
        </button>
      </div>
      {summary && <div className={`text-xs ${textSecondary}`} data-settings-card-summary>{summary}</div>}
      {checked && children}
    </section>
  );
}
