/** Life Planner is a purpose/vision workspace, never a second task inbox.
 * Planning conversions: 12 months / 365 days per year. Project dates use calendar arithmetic.
 */
export const MAX_WISHES = 100;
export const MAX_VISION_STEPS = 30;
export const SWOT_FACTORS = ['s', 'w', 'o', 't'];
export const SWOT_GROUPS = ['so', 'wo', 'st', 'wt'];
export const MAX_SWOT_STRATEGIES = 20;
export const UNIT_YEARS = { year: 1, month: 1 / 12, day: 1 / 365 };
export const CATEGORY_IDS = ['self', 'career', 'wealth', 'learning', 'creation', 'health', 'leisure', 'travel', 'family', 'social', 'other'];
export const uid = () => crypto.randomUUID();
const finite = value => value !== '' && value != null && Number.isFinite(Number(value));
const boundedText = (value, max = 2000) => typeof value === 'string' && value.length <= max;
const validId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
export const years = (amount, unit) => Number(amount) * (UNIT_YEARS[unit] ?? NaN);
export const pretty = value => String(Math.round(Number(value) * 10000) / 10000);

// A time phrase is parsed separately, so “出版2本书，3年内” is ONE measure, not two.
// Never silently choose the first numeral in an ambiguous outcome.
export function parseVisionText(text) {
  let outcome = String(text || '').trim();
  let amount = 5, unit = 'year';
  const duration = outcome.match(/(?:[，,;；\s]+|^)(?:in\s+)?(\d+(?:\.\d+)?)\s*(years?|months?|days?|年|个月|月|天)(?:内|以内|\.)?\s*$/i);
  if (duration) {
    amount = Number(duration[1]);
    const label = duration[2].toLowerCase();
    unit = label.startsWith('year') || label === '年' ? 'year' : label.startsWith('month') || label.includes('月') ? 'month' : 'day';
    outcome = outcome.slice(0, duration.index).trim();
  }
  const matches = [...outcome.matchAll(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*[%％])?/g)];
  const match = matches.length === 1 ? matches[0] : null;
  const target = match ? Number(match[0].replace(/[,\s%％]/g, '')) : 100;
  const percentage = !!match && /[%％]/.test(match[0]);
  return {
    outcome, amount, unit, valid: !!match && Number.isFinite(target), target,
    prefix: match ? outcome.slice(0, match.index) : '',
    suffix: match ? `${percentage ? '%' : ''}${outcome.slice(match.index + match[0].length)}` : '',
  };
}
export const measureText = (outcome, value) => {
  const m = parseVisionText(outcome);
  return m.valid ? `${m.prefix}${pretty(value)}${m.suffix}` : outcome;
};
export function createVision(text = '', today = localDate(), id = uid()) {
  const parsed = parseVisionText(text);
  return { id, title: parsed.outcome, amount: parsed.amount, unit: parsed.unit, current: 0, completed: false, startDate: today, steps: [] };
}
export function createWish(title, category = 'other', id = uid()) {
  return { id, title: String(title).trim(), category, starred: false, completed: false, visions: [] };
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function isDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) return false;
  const d = new Date(`${text}T12:00:00`);
  return Number.isFinite(+d) && localDate(d) === text;
}
export function addDuration(date, amount, unit) {
  if (!isDate(date) || !finite(amount) || !Number.isInteger(Number(amount)) || amount <= 0 || !Object.hasOwn(UNIT_YEARS, unit)) throw new Error('duration');
  const d = new Date(`${date}T12:00:00`);
  // Units are integer calendar periods; clamp month-end rather than overflowing.
  if (unit === 'day') d.setDate(d.getDate() + Number(amount));
  else {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + Number(amount) * (unit === 'year' ? 12 : 1));
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }
  return localDate(d);
}
export function validateVision(v) {
  if (!boundedText(v.title) || !parseVisionText(v.title).valid) return 'measure';
  if (!isDate(v.startDate)) return 'date';
  if (!Object.hasOwn(UNIT_YEARS, v.unit) || !Number.isInteger(Number(v.amount)) || years(v.amount, v.unit) < 3 - 1e-8 || years(v.amount, v.unit) > 5 + 1e-8) return 'horizon';
  if (!finite(v.current)) return 'number';
  if (!Array.isArray(v.steps) || v.steps.length > MAX_VISION_STEPS) return 'steps';
  const ids = new Set();
  for (const step of v.steps) {
    if (!validId(step.id) || ids.has(step.id)) return 'steps';
    ids.add(step.id);
    if (!finite(step.value)) return 'number';
    if (!Number.isInteger(Number(step.amount)) || Number(step.amount) <= 0 || !Object.hasOwn(UNIT_YEARS, step.unit) || years(step.amount, step.unit) > 5) return 'duration';
    if (step.projectId != null && !validId(step.projectId)) return 'steps';
    if (step.goalId != null && !validId(step.goalId)) return 'steps';
  }
  // Steps are successive durations, not repeated offsets from today.
  if (totalYears(v) > years(v.amount, v.unit) + 1e-8) return 'total';
  return null;
}
export const totalYears = v => v.steps.reduce((sum, step) => sum + years(step.amount, step.unit), 0);

// The saved format stores successive durations because it has been part of the
// local backup format since the first Life Planner prototype. The editor uses
// absolute offsets instead: a row at 2 years means the second checkpoint is
// reached two years from the start, even when the first checkpoint is at year 1.
// Keeping the conversion here makes the UI readable without changing backups.
const rounded = value => Math.round(Number(value) * 100) / 100;
const integerish = value => Math.abs(value - Math.round(value)) < 1e-8;

export const maxVisionOffset = vision => Math.max(0, ...(vision?.steps || []).map(step => years(step.amount, step.unit)).filter(Number.isFinite));

function durationForYears(value, preferred = 'year') {
  const target = Number(value);
  if (!Number.isFinite(target) || target <= 0) throw new Error('duration');
  const preferredFactor = UNIT_YEARS[preferred];
  const preferredAmount = target / preferredFactor;
  if (integerish(preferredAmount)) return { amount: Math.round(preferredAmount), unit: preferred };
  const monthAmount = target / UNIT_YEARS.month;
  if (integerish(monthAmount)) return { amount: Math.round(monthAmount), unit: 'month' };
  const dayAmount = target / UNIT_YEARS.day;
  if (integerish(dayAmount)) return { amount: Math.round(dayAmount), unit: 'day' };
  // Do not silently move a calendar checkpoint when the edited offset cannot
  // be represented by the existing integral year/month/day schema.
  throw new Error('duration');
}

export function toAbsoluteVision(vision) {
  let elapsed = 0;
  return { ...vision, steps: (vision?.steps || []).map(step => {
    elapsed += years(step.amount, step.unit);
    const preferred = Object.hasOwn(UNIT_YEARS, step.unit) ? step.unit : 'year';
    const factor = UNIT_YEARS[preferred];
    const preferredAmount = elapsed / factor;
    // Preserve the familiar unit where possible. Mixed legacy units fall back
    // to a year value rather than inventing a new persisted field.
    return { ...step, amount: integerish(preferredAmount) ? Math.round(preferredAmount) : elapsed, unit: integerish(preferredAmount) ? preferred : 'year' };
  }) };
}

export function toStoredVision(vision, baseline = null) {
  let previous = 0;
  const preserved = new Map();
  let baselineOffset = 0;
  for (const step of baseline?.steps || []) {
    baselineOffset += years(step.amount, step.unit);
    preserved.set(step.id, { offset: baselineOffset, amount: step.amount, unit: step.unit });
  }
  const steps = (vision?.steps || []).map(step => {
    const offset = years(step.amount, step.unit);
    const duration = offset - previous;
    if (!Number.isFinite(offset) || !Number.isFinite(duration) || duration <= 0) throw new Error('duration');
    previous = offset;
    const unchanged = preserved.get(step.id);
    if (unchanged && Math.abs(unchanged.offset - offset) < 1e-8 && Math.abs(years(unchanged.amount, unchanged.unit) - duration) < 1e-8) {
      return { ...step, amount: Number(unchanged.amount), unit: unchanged.unit };
    }
    return { ...step, ...durationForYears(duration, Object.hasOwn(UNIT_YEARS, step.unit) ? step.unit : 'year') };
  });
  return { ...vision, steps };
}

// A new checkpoint is an absolute year offset. Its suggested value follows the
// straight line from current to target, so the first two defaults of a
// three-year vision are year 1 and year 2 rather than durations 1 and 2.
export function suggestVisionStep(vision, id = uid()) {
  const horizon = years(vision?.amount, vision?.unit);
  const used = maxVisionOffset(vision);
  if (!Number.isFinite(horizon) || horizon <= 0 || used >= horizon - 1e-8 || (vision?.steps || []).length >= MAX_VISION_STEPS) return null;
  const previous = vision?.steps?.at(-1);
  const previousOffset = previous ? years(previous.amount, previous.unit) : 0;
  const desired = Math.max(1, previousOffset + 1);
  // Keep the new blank row representable by the existing integer calendar
  // units. A legacy month checkpoint therefore suggests 13 months, while a
  // one-day checkpoint suggests 366 days instead of an uneditable 1.08 years.
  const candidates = Object.keys(UNIT_YEARS).flatMap(unit => {
    const maxAmount = Math.floor((Math.min(horizon, 5) / UNIT_YEARS[unit]) + 1e-8);
    return Array.from({ length: Math.max(0, maxAmount) }, (_, index) => {
      const amount = index + 1;
      return { amount, unit, offset: amount * UNIT_YEARS[unit] };
    });
  }).filter(candidate => {
    if (!(candidate.amount > 0 && candidate.offset > previousOffset + 1e-8 && candidate.offset <= horizon + 1e-8)) return false;
    try { durationForYears(candidate.offset - previousOffset, candidate.unit); return true; }
    catch { return false; }
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.offset - desired) - Math.abs(b.offset - desired));
  const { amount, unit, offset } = candidates[0];
  const parsed = parseVisionText(vision?.title || '');
  const current = finite(vision?.current) ? Number(vision.current) : 0;
  const value = rounded(current + (parsed.target - current) * (offset / horizon));
  return { id, value, amount, unit };
}

export function milestoneDate(vision, stepId) {
  let date = vision.startDate;
  for (const step of vision.steps) {
    date = addDuration(date, step.amount, step.unit);
    if (step.id === stepId) return date;
  }
  throw new Error('missing');
}
export function reorder(list, id, delta) {
  const index = list.findIndex(item => item.id === id), target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const result = [...list];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}
export function defaultDocument(principles = []) {
  return { version: 1, revision: 0, wishes: [], principles: principles.map((text, index) => ({ id: `principle-${index}`, text })), updatedAt: null };
}
export function createSwot() {
  return { version: 1, factors: Object.fromEntries(SWOT_FACTORS.map(key => [key, ''])), strategies: Object.fromEntries(SWOT_GROUPS.map(key => [key, []])) };
}
export function validateSwot(swot, checkId = () => {}) {
  if (!swot || swot.version !== 1 || !swot.factors || !swot.strategies) throw new Error('format');
  for (const key of SWOT_FACTORS) if (!boundedText(swot.factors[key], 4000)) throw new Error('format');
  const ids = new Set();
  for (const key of SWOT_GROUPS) {
    const rows = swot.strategies[key];
    if (!Array.isArray(rows) || rows.length > MAX_SWOT_STRATEGIES) throw new Error('format');
    for (const row of rows) {
      if (!row || !validId(row.id) || ids.has(row.id) || !boundedText(row.text) || (row.visionId != null && !validId(row.visionId))) throw new Error('format');
      ids.add(row.id); checkId(row.id);
    }
  }
  return swot;
}
export function validateDocument(doc) {
  if (!doc || doc.version !== 1 || !Number.isSafeInteger(doc.revision) || doc.revision < 0) throw new Error('format');
  if (!Array.isArray(doc.wishes) || doc.wishes.length > MAX_WISHES || !Array.isArray(doc.principles) || doc.principles.length > 100) throw new Error('format');
  const ids = new Set();
  const checkId = id => { if (!validId(id) || ids.has(id)) throw new Error('format'); ids.add(id); };
  for (const w of doc.wishes) {
    checkId(w.id);
    if (!boundedText(w.title) || !w.title.trim() || !CATEGORY_IDS.includes(w.category) || typeof w.starred !== 'boolean' || typeof w.completed !== 'boolean' || !Array.isArray(w.visions) || w.visions.length > 30) throw new Error('format');
    if (w.swot !== undefined) validateSwot(w.swot, checkId);
    for (const v of w.visions) {
      checkId(v.id);
      if (typeof v.completed !== 'boolean' || validateVision(v)) throw new Error('format');
      for (const step of v.steps) checkId(step.id);
    }
  }
  for (const p of doc.principles) {
    checkId(p.id);
    if (!boundedText(p.text) || !p.text.trim()) throw new Error('format');
  }
  return doc;
}
export function updateWish(doc, id, change, expected) {
  const found = doc.wishes.find(w => w.id === id);
  if (!found) throw new Error('missing');
  if (expected && JSON.stringify(found) !== JSON.stringify(expected)) throw new Error('conflict');
  return { ...doc, wishes: doc.wishes.map(w => w.id === id ? { ...w, ...change } : w) };
}
export function saveVision(doc, wishId, vision, expected) {
  const wish = doc.wishes.find(w => w.id === wishId);
  if (!wish) throw new Error('missing');
  const current = wish.visions.find(v => v.id === vision.id);
  if (JSON.stringify(current ?? null) !== JSON.stringify(expected ?? null)) throw new Error('conflict');
  const error = validateVision(vision);
  if (error) throw new Error(error);
  const normalized = {
    ...vision,
    amount: Number(vision.amount),
    current: Number(vision.current),
    steps: vision.steps.map(s => ({
      ...s,
      value: Number(s.value),
      amount: Number(s.amount),
      ...(s.projectId == null ? {} : { projectId: s.projectId }),
      ...(s.goalId == null ? {} : { goalId: s.goalId }),
    })),
  };
  return updateWish(doc, wishId, { visions: current ? wish.visions.map(v => v.id === vision.id ? normalized : v) : [...wish.visions, normalized] });
}
// Native project creation remains opt-in. Purpose/vision completion never changes it.
// The optional native-link fields are deliberately additive so existing callers
// continue to receive the original project payload byte-for-byte.
export function projectFields(wish, vision, step, description, options = {}) {
  const fields = { title: measureText(vision.title, step.value), description, targetDate: milestoneDate(vision, step.id), color: 'bg-blue-500' };
  if (options.goalId != null) fields.goalId = options.goalId;
  if (options.lifeplanner != null) fields.lifeplanner = options.lifeplanner;
  return fields;
}
