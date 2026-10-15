// One Settings topic's page: its visible blocks, separated (#2075). Two cards
// next to each other need no rule between them: their borders already do it.
import React from 'react';
import { visibleSectionKeys } from './settingsTopics.js';

export default function SettingsTopicPage({ topic, sections, borderClass }) {
  const keys = visibleSectionKeys(topic, sections);
  return (
    <div className="space-y-6" data-settings-page={topic?.id}>
      {keys.map((key, i) => (
        <React.Fragment key={key}>
          {i > 0 && !(sections[key].card && sections[keys[i - 1]].card) && <hr className={borderClass} />}
          <div data-settings-section={key}>{sections[key].node}</div>
        </React.Fragment>
      ))}
    </div>
  );
}
