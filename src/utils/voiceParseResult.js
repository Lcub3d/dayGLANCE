/**
 * Normalises whatever the AI returned for a voice transcript into the shape
 * the voice pipeline applies: { newTasks: [], edits: [] }.
 *
 * The prompt (ai-prompts.js, voiceParseSystemPrompt) asks for exactly that
 * object, and the pipeline used to read it with
 *   newTasks = Array.isArray(result.newTasks) ? result.newTasks : []
 * which turns every OTHER shape — a model that answered {"tasks": [...]}, a
 * bare task object, an empty {} — into "nothing to do", with no error and no
 * fallback. The user sees "No tasks or edits were parsed from your input" and
 * has no way to tell that from a transcript that genuinely held no task. That
 * is the report: "AI voice input doesn't give an error, it just says it failed
 * to parse a task."
 *
 * So: the documented shape and its common drifts are accepted; anything else
 * throws VOICE_PARSE_SHAPE, which the pipeline's existing catch turns into the
 * deterministic parser plus a visible "parsed without AI" notice. An answer of
 * the RIGHT shape that is simply empty is not an error — the transcript was
 * heard and held nothing — and is passed through as such.
 */

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const looksLikeTask = (v) => isRecord(v) && typeof v.title === 'string';
const looksLikeEdit = (v) => isRecord(v) && typeof v.action === 'string' && typeof v.taskMatch === 'string';

/** A compact, safe description of a bad response, for the error message. */
export const describeShape = (result) => {
  if (result === null) return 'null';
  if (Array.isArray(result)) return `array of ${result.length}`;
  if (typeof result !== 'object') return typeof result;
  const keys = Object.keys(result);
  return keys.length ? `object with keys ${keys.slice(0, 6).join(', ')}` : 'empty object';
};

export class VoiceParseShapeError extends Error {
  constructor(result) {
    super(`unexpected AI response shape: ${describeShape(result)}`);
    this.name = 'VoiceParseShapeError';
    this.code = 'VOICE_PARSE_SHAPE';
    this.received = describeShape(result);
  }
}

export function normalizeVoiceParseResult(result) {
  // A bare array is the pre-edit-commands shape the prompt once asked for;
  // still honoured. Non-task entries are dropped rather than applied blind.
  if (Array.isArray(result)) {
    return { newTasks: result.filter(looksLikeTask), edits: [] };
  }
  if (!isRecord(result)) throw new VoiceParseShapeError(result);

  const hasNew = Array.isArray(result.newTasks);
  const hasEdits = Array.isArray(result.edits);
  if (hasNew || hasEdits) {
    return {
      newTasks: hasNew ? result.newTasks.filter(looksLikeTask) : [],
      edits: hasEdits ? result.edits.filter(looksLikeEdit) : [],
    };
  }
  // Common drift: the model named the array "tasks".
  if (Array.isArray(result.tasks)) {
    return { newTasks: result.tasks.filter(looksLikeTask), edits: [] };
  }
  // A single task, or a single edit, returned bare.
  if (looksLikeTask(result)) return { newTasks: [result], edits: [] };
  if (looksLikeEdit(result)) return { newTasks: [], edits: [result] };

  throw new VoiceParseShapeError(result);
}
