import { describe, it, expect } from 'vitest';
import {
  noteTextHash, splitNoteDescription, extractNoteDescription, replaceNoteDescription,
  mergeNoteDescription, appendDescriptionConflict, DESCRIPTION_PLACEHOLDERS,
} from './noteDescription.js';
import { defaultProjectNote, defaultGoalNote, renderNoteTemplateSubset } from './projectNotes.js';
import { withCreationFrontmatter } from './frontmatter.js';

const NOTE = withCreationFrontmatter(defaultProjectNote({ title: 'House', date: '2026-10-03' }), '2026-10-03');

describe('the description section (owner ruling 2026-10-03)', () => {
  it('is the text between the H1 and the first heading, frontmatter and tasks untouched around it', () => {
    const parts = splitNoteDescription(NOTE);
    expect(parts.head).toBe('---\ncreated: 2026-10-03\nsource: dayGLANCE\n---\n# House\n');
    expect(parts.section).toBe(DESCRIPTION_PLACEHOLDERS[0]);
    expect(parts.tail.startsWith('## Tasks\n')).toBe(true);
    expect(extractNoteDescription('# T\n\nA line.\n\nSecond block.\n\n## Tasks\n- [ ] x\n')).toBe('A line.\n\nSecond block.');
    // No H1: the section starts after the frontmatter; no headings at all: the whole body.
    expect(extractNoteDescription('---\na: 1\n---\n\nIntro\n## Tasks\n')).toBe('Intro');
    expect(extractNoteDescription('Just text\n')).toBe('Just text');
    expect(extractNoteDescription('# T\n## Tasks\n')).toBe('');
    expect(extractNoteDescription('---\r\na: 1\r\n---\r\n# T\r\nCRLF text\r\n## Tasks\r\n')).toBe('CRLF text');
  });

  it('replace writes exactly the section and leaves the rest byte for byte', () => {
    const out = replaceNoteDescription(NOTE, 'What done looks like: the roof holds.');
    expect(out).toBe(NOTE.replace(DESCRIPTION_PLACEHOLDERS[0], 'What done looks like: the roof holds.'));
    expect(extractNoteDescription(out)).toBe('What done looks like: the roof holds.');
    // Blank removes the section; a note with no tail gets the text and a newline.
    expect(replaceNoteDescription('# T\n\nOld\n\n## Tasks\n', '')).toBe('# T\n## Tasks\n');
    expect(replaceNoteDescription('# T\n', 'New')).toBe('# T\nNew\n');
    // Round trip: replacing with what is there changes nothing.
    expect(replaceNoteDescription(out, extractNoteDescription(out))).toBe(out);
  });

  it('merge (the migration): placeholder or blank is replaced, existing text keeps the dayGLANCE text below it, a present body changes nothing', () => {
    const first = mergeNoteDescription(NOTE, 'Purpose: keep the house dry.');
    expect(first.changed).toBe(true);
    expect(extractNoteDescription(first.text)).toBe('Purpose: keep the house dry.');
    const hub = '# GSL\n\nMy own hub paragraph.\n\n## Tasks\n- [ ] x\n';
    const merged = mergeNoteDescription(hub, 'Purpose: ship.');
    expect(extractNoteDescription(merged.text)).toBe('My own hub paragraph.\n\nPurpose: ship.');
    expect(merged.text).toContain('## Tasks\n- [ ] x\n');
    expect(mergeNoteDescription(merged.text, 'Purpose: ship.')).toEqual({ text: merged.text, changed: false });
    expect(mergeNoteDescription(hub, '   ').changed).toBe(false);
    expect(extractNoteDescription(mergeNoteDescription(defaultGoalNote({ title: 'G', date: '2026-10-03' }), 'Why').text)).toBe('Why');
  });

  it('the conflict callout keeps the vault text and adds the dayGLANCE text once, dated', () => {
    const hub = '# GSL\n\nEdited in Obsidian.\n\n## Tasks\n';
    const out = appendDescriptionConflict(hub, 'Typed in dayGLANCE.', '2026-10-03 09:00');
    expect(out.changed).toBe(true);
    expect(extractNoteDescription(out.text)).toBe('Edited in Obsidian.\n\n> [!note] Edited in dayGLANCE 2026-10-03 09:00\n> Typed in dayGLANCE.');
    expect(appendDescriptionConflict(out.text, 'Typed in dayGLANCE.', '2026-10-03 09:00').changed).toBe(false);
    expect(appendDescriptionConflict(hub, '', 'x').changed).toBe(false);
  });

  it('the hash is stable across line endings and sensitive to content', () => {
    expect(noteTextHash('a\r\nb')).toBe(noteTextHash('a\nb'));
    expect(noteTextHash('a')).not.toBe(noteTextHash('b'));
    expect(noteTextHash('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('the default notes take a description in the placeholder slot, and the template subset renders {{description}}', () => {
    expect(extractNoteDescription(defaultProjectNote({ title: 'House', date: 'd', description: 'Dry roof.' }))).toBe('Dry roof.');
    expect(extractNoteDescription(defaultProjectNote({ title: 'House', date: 'd', description: '  ' }))).toBe(DESCRIPTION_PLACEHOLDERS[0]);
    expect(extractNoteDescription(defaultGoalNote({ title: 'G', date: 'd', description: 'Why.' }))).toBe('Why.');
    expect(renderNoteTemplateSubset('# {{title}}\n{{description}}\n', { title: 'T', description: 'D' })).toBe('# T\nD\n');
    expect(renderNoteTemplateSubset('{{ description }}', {})).toBe('');
  });
});
