// A goal's notes (#2076): the same box the Project Planner shows for a
// project (components/notes/EntityNotesBox.jsx), so the description is read
// formatted and edited in place instead of through a two-line field in the
// Edit Goal form. For a goal linked to an Obsidian note it is the note's
// description section, which the record leaves empty: until this box, such a
// goal showed no description anywhere outside the form.
//
// Shown on the goal's card (the List view's selected goal, and each goal page
// on a phone) and on the Roadmap's goal detail. Callers key it by goal id, so
// switching goals flushes this one's notes and loads the next.

import React from 'react';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { TAILWIND_TO_HEX } from '../../utils/colorUtils.js';
import useEntityNotes from '../../hooks/useEntityNotes.js';
import EntityNotesBox from '../notes/EntityNotesBox.jsx';

export default function GoalNotes({ goal, showLabel = true, className = '' }) {
  const { updateGoal } = useFeaturesCtx();
  const state = useEntityNotes({
    kind: 'goal', entity: goal,
    saveRecord: (description) => updateGoal(goal.id, { description }),
    editWhenEmpty: false,
  });
  return <EntityNotesBox state={state} accentHex={TAILWIND_TO_HEX[goal.color]} showLabel={showLabel} className={className} />;
}
