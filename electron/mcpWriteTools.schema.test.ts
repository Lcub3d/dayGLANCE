import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerWriteTools, type WriteToolDeps } from './mcpWriteTools.js';

// The tool text is the contract a model reads before its first call. Project
// tasks take priority and deadline (#1913), so no description may still tell
// a model they are excluded, and update_task must say the id create_task
// returned survives the Obsidian re-key. Pinned here because the behaviour
// fix shipped once with the old strings still in place.

interface Registered { description: string; inputSchema: { shape: Record<string, { description?: string }> } }

function register(multiUser: boolean): Map<string, Registered> {
  const tools = new Map<string, Registered>();
  const server = {
    registerTool: (name: string, config: Registered) => { tools.set(name, config); },
  } as unknown as McpServer;
  registerWriteTools(server, { multiUserEnabled: () => multiUser } as unknown as WriteToolDeps);
  return tools;
}

const EXCLUDES_PROJECTS = /without a project|non-project|project tasks (do not|don't|never) carry|scheduled and project tasks/i;

describe.each([false, true])('task tool schema text (multi-user %s)', (multiUser) => {
  const tools = register(multiUser);

  it.each(['dayglance_update_task', 'dayglance_create_task'])('%s: priority and deadline cover unscheduled project tasks', (name) => {
    const tool = tools.get(name)!;
    expect(tool.description).not.toMatch(EXCLUDES_PROJECTS);
    for (const field of ['priority', 'deadline', 'project_id', 'clear_fields']) {
      const text = tool.inputSchema.shape[field]?.description;
      if (text === undefined) continue; // update_task has no project_id; create_task has no clear_fields
      expect(text, `${name}.${field}`).not.toMatch(EXCLUDES_PROJECTS);
    }
    for (const field of ['priority', 'deadline']) {
      expect(tool.inputSchema.shape[field]!.description).toMatch(/Unscheduled tasks only \(inbox or project\)/);
      expect(tool.inputSchema.shape[field]!.description).toMatch(/Scheduled tasks do not carry/);
    }
  });

  it('update_task says an id from create_task keeps working after the Obsidian re-key', () => {
    const { description } = tools.get('dayglance_update_task')!;
    expect(description).toMatch(/returned by dayglance_create_task keeps working/);
    expect(description).toMatch(/obsidian-dg-/);
    expect(description).toMatch(/resolved_from/);
  });
});
