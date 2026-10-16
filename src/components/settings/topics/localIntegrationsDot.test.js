import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The Local Integrations dot is read from the main process's status when the
// topic loads. It used to be reported by the card's body, which mounts only
// once the card is opened, so the dot waited for that and was gone again
// after Settings was reopened.
const topic = readFileSync(new URL('./useIntegrationsTopic.jsx', import.meta.url), 'utf8');

describe('Local Integrations dot', () => {
  it('comes from the MCP status, not from the card body', () => {
    expect(topic).toContain('const localIntegrationsConfig = useMcpStatus().snapshot?.config;');
    expect(topic).not.toContain('onActiveChange');
    expect(topic).not.toMatch(/useState\(false\);\s*\n\s*return \{\s*\n\s*calendarSync/);
  });
});
