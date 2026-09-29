// LifeMap dates stay with their existing owner. A native binding keeps its
// goal/project facet; notebook visions/stages remain derived from the notebook.
// Only free-form nodes use the optional schedule facet on the SAME lifeNode.
import { addDuration, isDate, milestoneDate } from './model.js';

export function scheduleOwner(node) {
  const owner = node.details?.schedule?.owner;
  if (['goal', 'project', 'vision', 'stage'].includes(owner)) return owner;
  if (['goal', 'project'].includes(node.type) && node.bindings?.[`${node.type}Id`]) return node.type;
  if (node.bindings?.goalId) return 'goal';
  if (node.bindings?.projectId) return 'project';
  if (node.details?.vision) return 'vision';
  if (node.details?.stage) return 'stage';
  return 'schedule';
}

export function validSchedule({ startDate = null, targetDate = null } = {}) {
  const empty = value => value === null || value === undefined || value === '';
  return (empty(startDate) || (typeof startDate === 'string' && isDate(startDate)))
    && (empty(targetDate) || (typeof targetDate === 'string' && isDate(targetDate)))
    && !(startDate && targetDate && startDate > targetDate);
}

export function readLifeSchedule(node, nodes = []) {
  const source = scheduleOwner(node), editable = !['vision', 'stage'].includes(source);
  let startDate = null, targetDate = null;
  try {
    if (source === 'vision') {
      const v = node.details.vision;
      startDate = v.startDate;
      targetDate = addDuration(v.startDate, v.amount, v.unit);
    } else if (source === 'stage') {
      const parent = nodes.find(n => n.details?.vision && n.bindings?.wishId === node.bindings?.wishId
        && n.bindings?.visionId === node.bindings?.visionId);
      if (!parent) return { source, editable, startDate: null, targetDate: null, invalid: true };
      const v = parent.details.vision, order = v.stepOrder || [];
      const siblings = nodes.filter(n => n.details?.stage && n.bindings?.wishId === node.bindings?.wishId
        && n.bindings?.visionId === node.bindings?.visionId)
        .sort((a, b) => order.indexOf(a.bindings.stageId) - order.indexOf(b.bindings.stageId)
          || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const steps = siblings.map(n => n.details.stage), index = siblings.findIndex(n => n.id === node.id);
      const vision = { ...v, steps };
      targetDate = milestoneDate(vision, node.bindings.stageId);
      startDate = index > 0 ? milestoneDate(vision, steps[index - 1].id) : v.startDate;
    } else {
      const fields = node.details?.[source] || {};
      startDate = fields.startDate ?? null;
      targetDate = fields.targetDate ?? null;
    }
    return { source, editable, startDate: startDate || null, targetDate: targetDate || null,
      invalid: !validSchedule({ startDate, targetDate }) };
  } catch {
    return { source, editable, startDate: null, targetDate: null, invalid: true };
  }
}

/** A patch to the existing node, suitable for patchLifeNode(expectedHead).
 * Never creates a second owner, touches hierarchy, cascades dates or schedules
 * tasks. Clearing dates is explicit and does not mean "use createdAt". */
export function withLifeSchedule(node, { startDate, targetDate }) {
  const source = scheduleOwner(node);
  if (source === 'vision' || source === 'stage') throw new Error('scheduleDerived');
  if (!validSchedule({ startDate, targetDate })) throw new Error('scheduleDate');
  const details = { ...node.details }, facet = { ...details[source] };
  for (const [key, value] of Object.entries({ startDate, targetDate })) {
    if (value) facet[key] = value; else delete facet[key];
  }
  if (source === 'schedule' && Object.keys(facet).length === 0) delete details.schedule;
  else details[source] = facet;
  return { ...node, details };
}
