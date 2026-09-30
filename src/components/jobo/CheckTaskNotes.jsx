import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckDialog } from './CheckPanel.jsx';
import { DoTaskNotes } from './DoNotesPanel.jsx';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';

// A destination for the journal's Notes link on every width, including when
// the task has moved off this day's timeline. All content/actions are the
// same native panel used by Do cards; nothing is copied into the journal.
export default function CheckTaskNotes({ task, ...props }) {
  const { t } = useTranslation();
  return <CheckDialog {...props} reading={false} title={t('task.notes')}
    subtitle={task ? renderTitleWithoutTags(task.title) : ''}>
    {task ? <div className={`${task.color || 'bg-blue-500'} rounded-lg`}>
      <DoTaskNotes key={task.id} task={task} />
    </div> : <p role="status">{t('jobo.check.notesUnavailable')}</p>}
  </CheckDialog>;
}
