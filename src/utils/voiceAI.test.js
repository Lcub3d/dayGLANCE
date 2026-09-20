import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { aiKeyed, voiceUsesAI, voiceTranscribesWithAI } from './voiceAI.js';

const on = (extra = {}) => ({ enabled: true, provider: 'openai', apiKey: 'k', features: { voiceTaskInput: true }, ...extra });

describe('voiceUsesAI — the "Voice task input" toggle means "use AI for voice"', () => {
  it('is on with AI enabled, a key, and the toggle on (or unset — default on)', () => {
    expect(voiceUsesAI(on())).toBe(true);
    expect(voiceUsesAI(on({ features: {} }))).toBe(true);
    expect(voiceUsesAI(on({ features: undefined }))).toBe(true);
  });

  // The report: AI on, toggle off. This must read as "non-AI voice", never as
  // "no voice" — the pipeline falls to platform speech + deterministic parse.
  it('is off when the toggle is off, even with AI fully configured', () => {
    expect(voiceUsesAI(on({ features: { voiceTaskInput: false } }))).toBe(false);
  });

  it('is off when AI is disabled or unkeyed, whatever the toggle says', () => {
    expect(voiceUsesAI(on({ enabled: false }))).toBe(false);
    expect(voiceUsesAI(on({ apiKey: '' }))).toBe(false);
    expect(voiceUsesAI(undefined)).toBe(false);
  });

  it('treats Ollama as keyed', () => {
    expect(aiKeyed({ provider: 'ollama', apiKey: '' })).toBe(true);
    expect(voiceUsesAI(on({ provider: 'ollama', apiKey: '' }))).toBe(true);
  });
});

describe('voiceTranscribesWithAI', () => {
  it('additionally requires a provider that can transcribe', () => {
    expect(voiceTranscribesWithAI(on({ provider: 'openai' }))).toBe(true);
    expect(voiceTranscribesWithAI(on({ provider: 'gemini' }))).toBe(true);
    // Anthropic/OpenRouter parse but cannot transcribe: platform speech for
    // the audio, the model for the parse.
    expect(voiceTranscribesWithAI(on({ provider: 'anthropic' }))).toBe(false);
  });

  it('follows the toggle', () => {
    expect(voiceTranscribesWithAI(on({ features: { voiceTaskInput: false } }))).toBe(false);
  });
});

// The four sites that used the toggle to hide voice input. Pinned at source
// level: re-adding the gate is a one-line change that no render test would
// catch without a full context tree, and this is exactly what shipped.
describe('nothing gates the microphone on the AI toggle', () => {
  it.each([
    'src/components/GlanceSidebar.jsx',
    'src/components/MobileGlanceSection.jsx',
    'src/components/TrayHeader.jsx',
    'src/hooks/useKeyboardShortcuts.js',
  ])('%s does not read features.voiceTaskInput', (file) => {
    // The config read specifically — not the i18n key shortcuts.voiceTaskInput
    // that labels the button.
    expect(readFileSync(file, 'utf-8')).not.toMatch(/features\??\.voiceTaskInput/);
  });

  it('the toggle is read only by the settings panels and the voice-AI rule', () => {
    // The pipeline goes through voiceAI.js; the two settings panels render
    // the checkbox; ai.js holds the default. Anything else is a new gate.
    for (const file of ['src/hooks/useVoiceInput.js', 'src/components/VoiceInputModal.jsx', 'src/components/TrayVoice.jsx']) {
      expect(readFileSync(file, 'utf-8'), file).not.toMatch(/features\??\.voiceTaskInput/);
    }
  });
});
