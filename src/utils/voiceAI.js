import { supportsTranscription } from '../ai.js';

/**
 * Whether the voice pipeline uses AI — the one place that rule lives.
 *
 * Voice input never requires AI: platform speech (native on-device STT, or
 * Web Speech in a browser) plus the deterministic quickAddParser cover it, and
 * typing is always there. So the mic button, the V shortcut and the tray's mic
 * are never gated on anything AI-related.
 *
 * What the "Voice task input" toggle under Settings › AI › AI features
 * controls is whether AI is used FOR voice: transcription through the provider
 * (Whisper/Gemini) and parsing through the model. Off means non-AI voice, not
 * no voice. Four components used to read that toggle as "hide the microphone",
 * while the pipeline itself ignored it — so with AI on and the toggle off the
 * button vanished, and where it did show, the toggle changed nothing.
 */
export const aiKeyed = (c) => !!(c?.apiKey || c?.provider === 'ollama');

/** Parse the transcript with the model, rather than the deterministic parser? */
export const voiceUsesAI = (c) =>
  !!c?.enabled && c?.features?.voiceTaskInput !== false && aiKeyed(c);

/** Record audio and transcribe it through the provider, rather than platform speech? */
export const voiceTranscribesWithAI = (c) => voiceUsesAI(c) && supportsTranscription(c);
