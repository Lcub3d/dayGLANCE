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
  useRef: value => {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = { current: value };
    return runtime.slots[index];
  },
  useCallback: callback => callback,
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

  it('keeps an unsaved Lifemap open until its navigation guard allows leaving', () => {
    const guard = vi.fn(() => false);
    render().props.value.registerJobuNavigationGuard(guard);

    render().props.value.setJobuPage('tasks');
    expect(elements(render())).toContain(child);
    expect(guard).toHaveBeenCalledTimes(1);

    guard.mockReturnValue(true);
    render().props.value.setJobuPage('tasks');
    expect(elements(render())).not.toContain(child);
  });

  it('checks the Lifemap guard before changing the native timeline view', () => {
    const unregister = render().props.value.registerJobuNavigationGuard(() => false);
    render().props.value.setJobuPage('year');
    expect(runtime.planner.setViewMode).not.toHaveBeenCalled();

    unregister();
    render().props.value.setJobuPage('year');
    expect(runtime.planner.setViewMode).toHaveBeenCalledWith('year');
  });

  it('does not let an old cleanup remove the current Lifemap guard', () => {
    const unregisterOld = render().props.value.registerJobuNavigationGuard(() => true);
    render().props.value.registerJobuNavigationGuard(() => false);
    unregisterOld();

    render().props.value.setJobuPage('tasks');
    expect(elements(render())).toContain(child);
  });
});
