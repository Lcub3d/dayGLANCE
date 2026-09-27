import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ slots: [], cursor: 0, planner: {}, features: {} }));
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: initial => {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = initial;
    return [runtime.slots[index], value => { runtime.slots[index] = value; }];
  },
  useRef: value => ({ current: value }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key }) }));
vi.mock('../../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => runtime.planner }));
vi.mock('../../context/FeaturesContext.jsx', async () => ({
  ...await vi.importActual('../../context/FeaturesContext.jsx'),
  useFeaturesCtx: () => runtime.features,
}));
const { default: JobuShell } = await import('./JobuShell.jsx');

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  return [node, ...elements(node.props.children)];
}
const child = <main data-native-calendar />;
function render() { runtime.cursor = 0; return JobuShell({ children: child }); }

describe('Jobu navigation shell', () => {
  beforeEach(() => {
    runtime.slots = [];
    runtime.planner = { darkMode: false, setViewMode: vi.fn() };
    runtime.features = { jobuRecords: [], jobuLoaded: true, setJoboEnabled: vi.fn() };
  });

  it('uses the native view without a second top navigation bar', () => {
    const tree = render();
    expect(elements(tree)).toContain(child);
    expect(elements(tree).some(element => element.type === 'nav')).toBe(false);
    expect(runtime.planner.setViewMode).not.toHaveBeenCalled();
  });

  it('opens Tasks through the shared entry and returns without changing the selected view', () => {
    render().props.value.setJobuPage('tasks');
    let tree = render();
    expect(elements(tree)).not.toContain(child);
    const tasks = elements(tree).find(element => typeof element.props.onClose === 'function');
    expect(tasks.props.headerActions).toBeDefined();
    tasks.props.onClose();
    tree = render();
    expect(elements(tree)).toContain(child);
    expect(runtime.planner.setViewMode).not.toHaveBeenCalled();
  });

  it('a dated task returns to the native Plan/Do view and enables it', () => {
    render().props.value.setJobuPage('tasks');
    render().props.value.setJobuPage('jobo');
    expect(runtime.features.setJoboEnabled).toHaveBeenCalledWith(true);
    expect(runtime.planner.setViewMode).toHaveBeenCalledWith('jobo');
    expect(elements(render())).toContain(child);
  });
});
