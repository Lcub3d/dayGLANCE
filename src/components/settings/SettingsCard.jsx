// The Settings card (docs/settings-redesign.md, "The card pattern"): a title,
// its own switch, and its settings only while the switch is on. Off shows the
// title, the switch and a one-line summary, so a page of cards stays short and
// shows at a glance what is on.
//
// Without `onToggle` it is a static card: the same frame, title and status
// badge, its contents always shown, for a section whose on and off live
// inside it (a Disconnect, a consent dialog, several sources of its own).
import React from 'react';

export default function SettingsCard({
  icon: Icon, title, checked, onToggle, switchLabel, hint, summary, badge, darkMode,
  textPrimary, textSecondary, borderClass, children, cardId, disabled = false,
}) {
  return (
    <section
      data-settings-card={cardId}
      data-settings-card-state={onToggle ? (checked ? 'on' : 'off') : 'static'}
      className={`rounded-xl border ${borderClass} p-4 space-y-3`}
    >
      <div className="flex items-center gap-3">
        {Icon && <Icon size={18} className={`${textSecondary} flex-shrink-0`} />}
        <div className={`flex-1 min-w-0 font-medium ${textPrimary} flex items-center gap-2`}>
          <span className="truncate">{title}</span>
          {badge}
        </div>
        {onToggle && (
        <button
          type="button"
          role="switch"
          aria-checked={!!checked}
          aria-label={switchLabel || title}
          data-settings-card-switch
          disabled={disabled}
          onClick={() => { if (!disabled) onToggle(!checked); }}
          className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-5' : 'left-1'}`} />
        </button>
        )}
      </div>
      {/* The hint starts at the card's edge, like the summary under it, so the
          lines below the title read as one left-aligned column. */}
      {hint && <p className={`text-xs ${textSecondary} -mt-1.5`} data-settings-card-hint>{hint}</p>}
      {summary && <div className={`text-xs ${textSecondary}`} data-settings-card-summary>{summary}</div>}
      {(checked || !onToggle) && children}
    </section>
  );
}
