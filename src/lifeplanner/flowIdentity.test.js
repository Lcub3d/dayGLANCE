import { it, expect } from 'vitest';
import { flowIdentity, domainIdentity } from './flowIdentity.js';
it.each(['["wish","健康"]', '["goal","quoted\\"id"]', "abc'[]\\/()", 'lm:special', 'plain'])('keeps domain ID %s while escaping the DOM projection', id => {
  const projected = flowIdentity(id);
  for (const forbidden of ['"', "'", '[', ']', '\\']) expect(projected).not.toContain(forbidden);
  expect(domainIdentity(projected)).toBe(id);
});
