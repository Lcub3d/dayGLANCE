// The Settings card (docs/settings-redesign.md, "The card pattern"): a title,
// its own switch, and its settings only while the switch is on. Off shows the
// title, the switch and a one-line summary, so a page of cards stays short and
// shows at a glance what is on.
//
// Without `onToggle` it is a static card: the same frame, title and status
// badge, its contents always shown, for a section whose on and off live
// inside it (a Disconnect, a consent dialog, several sources of its own).
// A static card can be `collapsible`: the title row opens and closes it, and
// `defaultOpen` says how it starts. Closed, it shows the title and the badge
// only, so a page of long sections stays a short list.
// `footer` renders under the contents whether the card is on or off.
// `contentsWhenOff` keeps a switched card's contents shown while it is off,
// for a card whose off state still has things to do (Direct Access: change
// the folder, disconnect).
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function SettingsCard({
  icon: Icon, title, checked, onToggle, switchLabel, hint, summary, badge, darkMode,
  textPrimary, textSecondary, borderClass, children, cardId, disabled = false,
  collapsible = false, defaultOpen = false, footer = null, contentsWhenOff = false,
}) {
  const canCollapse = collapsible && !onToggle;
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !canCollapse || open;

  const heading = (
    <>
      {Icon && <Icon size={18} className={`${textSecondary} flex-shrink-0`} />}
      <div className={`flex-1 min-w-0 font-medium ${textPrimary} flex items-center gap-2`}>
        <span className="min-w-0 break-words">{title}</span>
        {badge}
      </div>
    </>
  );

  let state = 'static';
  if (onToggle) state = checked ? 'on' : 'off';
  else if (canCollapse) state = open ? 'open' : 'closed';

  return (
    <section
      data-settings-card={cardId}
      data-settings-card-state={state}
      className={`rounded-xl border ${borderClass} p-4 space-y-3`}
    >
      {canCollapse ? (
        <button
          type="button"
          aria-expanded={open}
          data-settings-card-toggle
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 text-left"
        >
          {heading}
          <ChevronDown size={16} className={`${textSecondary} flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <div className="flex items-center gap-3">
          {heading}
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
      )}
      {/* The hint starts at the card's edge, like the summary under it, so the
          lines below the title read as one left-aligned column. */}
      {hint && expanded && <p className={`text-xs ${textSecondary} -mt-1.5`} data-settings-card-hint>{hint}</p>}
      {summary && <div className={`text-xs ${textSecondary}`} data-settings-card-summary>{summary}</div>}
      {(onToggle ? (checked || contentsWhenOff) : expanded) && children}
      {/* Shown on or off: a card's own Save and Cancel, while it has unsaved
          changes, must stay reachable after its switch is turned off. */}
      {footer}
    </section>
  );
}
