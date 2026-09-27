import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  slots: [],
  cursor: 0,
  now: 0,
  planner: null,
  features: null,
  writer: { write: vi.fn(), pendingIds: [], conflict: null },
  model: null,
  useRealLayout: false,
  useState(initial) {
    const index = this.cursor++;
    if (!Object.prototype.hasOwnProperty.call(this.slots, index)) {
      this.slots[index] = typeof initial === 'function' ? initial() : initial;
    }
    return [this.slots[index], next => {
      this.slots[index] = typeof next === 'function' ? next(this.slots[index]) : next;
    }];
  },
  useRef(initial) {
    const index = this.cursor++;
    if (!Object.prototype.hasOwnProperty.call(this.slots, index)) this.slots[index] = { current: initial };
    return this.slots[index];
  },
  useMemo(factory) {
    this.cursor++;
    return factory();
  },
  useCallback(callback) {
    this.cursor++;
    return callback;
  },
  useEffect() {
    this.cursor++;
    return undefined;
  },
  useLayoutEffect() {
    this.cursor++;
    return undefined;
  },
  reset() {
    this.slots = [];
    this.cursor = 0;
    this.now = 0;
    this.useRealLayout = false;
  },
}));

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual,
    useState: runtime.useState.bind(runtime),
    useRef: runtime.useRef.bind(runtime),
    useMemo: runtime.useMemo.bind(runtime),
    useCallback: runtime.useCallback.bind(runtime),
    useEffect: runtime.useEffect.bind(runtime),
    useLayoutEffect: runtime.useLayoutEffect.bind(runtime),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, values) => values?.count == null ? key : `${key}:${values.count}` }),
}));

vi.mock('../context/DayPlannerContext.jsx', () => ({
  useDayPlannerCtx: () => runtime.planner,
}));

vi.mock('../context/FeaturesContext.jsx', () => ({
  useFeaturesCtx: () => runtime.features,
}));

vi.mock('../hooks/useJoboViewWriter.js', () => ({
  default: () => runtime.writer,
}));

vi.mock('../jobo/viewModel.js', async () => {
  const actual = await vi.importActual('../jobo/viewModel.js');
  return {
    ...actual,
    assignOverlapColumns: (items, options) => runtime.useRealLayout
      ? actual.assignOverlapColumns(items, options)
      : items,
    buildJoboDayModel: () => runtime.model,
  };
});

vi.mock('../jobo/nativePlanAdapter.js', async () => {
  const actual = await vi.importActual('../jobo/nativePlanAdapter.js');
  return {
    ...actual,
    canGroupPlan: () => true,
    startPlanDrag: () => true,
  };
});

const { default: React } = await import('react');
const { default: JoboView } = await import('./JoboView.jsx');
const { default: JoboDayStats } = await import('./jobo/JoboDayStats.jsx');

const DATE = '2026-09-27';
const SCALE = 84;

function walk(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach(child => walk(child, found));
    return found;
  }
  if (!React.isValidElement(value)) return found;
  found.push(value);
  walk(value.props?.children, found);
  return found;
}

function findElement(tree, predicate) {
  return walk(tree).find(predicate);
}

function findElements(tree, predicate) {
  return walk(tree).filter(predicate);
}

function laneElement(tree, lane) {
  return findElement(tree, element => element.props?.['data-jobo-lane'] === lane);
}

function classElement(tree, className) {
  return findElement(tree, element => element.props?.className?.split?.(' ').includes(className));
}

function createWindowHarness() {
  const listeners = new Map();
  const fakeWindow = {
    addEventListener: vi.fn((type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    }),
    removeEventListener: vi.fn((type, listener) => listeners.get(type)?.delete(listener)),
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
  };
  return {
    fakeWindow,
    emit(type, event = {}) {
      [...(listeners.get(type) || [])].forEach(listener => listener(event));
    },
  };
}

function pointerEvent(lane, overrides = {}) {
  return {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 40,
    clientY: 500,
    currentTarget: lane,
    target: { closest: () => null },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

function dragEvent(currentTarget, overrides = {}) {
  return {
    button: 0,
    clientX: 40,
    clientY: 500,
    currentTarget,
    target: { closest: () => null },
    ctrlKey: false,
    dataTransfer: { setData: vi.fn(), effectAllowed: '', dropEffect: '' },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  };
}

function completionRecord(id, minute = 600) {
  const hour = String(Math.floor(minute / 60)).padStart(2, '0');
  const clockMinute = String(minute % 60).padStart(2, '0');
  const stamp = `${DATE}T${hour}:${clockMinute}:00+08:00`;
  return {
    id,
    taskId: null,
    title: `Completion ${id}`,
    source: 'completion',
    progress: 'completed',
    deleted: false,
    createdAt: stamp,
    updatedAt: stamp,
    observedAt: stamp,
    date: DATE,
    timing: 'untimed',
    startTime: null,
    endDate: null,
    endTime: null,
    planSnapshot: null,
  };
}

function completionItem(id, minute = 600) {
  const record = completionRecord(id, minute);
  return {
    id,
    groupKey: `record::${id}`,
    noteKey: null,
    record,
    task: null,
    sourceTask: null,
  };
}

function timedItem(id = 'timed-1', startMinute = 600, endMinute = 630) {
  return {
    id,
    groupKey: `record::${id}`,
    noteKey: null,
    record: {
      id,
      taskId: null,
      title: `Timed ${id}`,
      source: 'manual',
      progress: 'started',
      deleted: false,
      createdAt: `${DATE}T10:00:00+08:00`,
      updatedAt: `${DATE}T10:00:00+08:00`,
      observedAt: `${DATE}T10:00:00+08:00`,
      date: DATE,
      timing: 'timed',
      startTime: '10:00',
      endDate: DATE,
      endTime: '10:30',
      planSnapshot: null,
    },
    task: null,
    sourceTask: null,
    startMinute,
    endMinute,
  };
}

function createHarness({ pendingIds = [], planCount = 1, timedRecords = [], untimedRecords = [] } = {}) {
  const createTimelineTask = vi.fn(task => ({ ...task, id: 'created-plan' }));
  const tasks = Array.from({ length: planCount }, (_, index) => ({
    id: `task-${index + 1}`,
    title: `Plan ${index + 1}`,
    date: DATE,
    startTime: `${String(9 + index).padStart(2, '0')}:00`,
    duration: 30,
    completed: false,
  }));
  const plans = tasks.map((task, index) => ({
    id: `plan-${index + 1}`,
    groupKey: `group-${index + 1}`,
    noteKey: task.id,
    startMinute: 540 + index * 60,
    endMinute: 570 + index * 60,
    leftPct: 0,
    widthPct: 100,
    historical: false,
    currentTask: task,
    sourceTask: task,
    task,
    plan: { startTime: task.startTime, duration: task.duration },
  }));
  const cards = plans.map((plan, index) => ({
    dataset: { joboCard: plan.id },
    getBoundingClientRect: () => ({ left: 10, right: 120, top: 50 + index * 110, bottom: 140 + index * 110 }),
  }));
  const lane = {
    getBoundingClientRect: () => ({ left: 0, right: 500, top: 0, bottom: 1600, width: 500, height: 1600 }),
    querySelectorAll: vi.fn(() => cards),
  };
  const scroll = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, right: 500, top: 0, bottom: 1600, width: 500, height: 1600 }),
  };
  const task = tasks[0];
  runtime.planner = {
    selectedDate: new Date(`${DATE}T12:00:00`),
    tasks,
    unscheduledTasks: [],
    recurringTasks: [],
    expandedRecurringTasks: [],
    currentTime: new Date(`${DATE}T23:58:00`),
    darkMode: false,
    cardBg: 'bg-white',
    borderClass: 'border-stone-200',
    textPrimary: 'text-stone-900',
    textSecondary: 'text-stone-500',
    isVisibleForUser: () => true,
    getTasksForDate: () => tasks,
    getFrameInstancesForDate: () => [],
    formatTime: value => value,
    createTimelineTask,
    moveTimelineTasks: vi.fn(() => true),
    deleteTimelineTasks: vi.fn(() => true),
    setExpandedNotesTaskId: vi.fn(),
    setTaskContextMenu: vi.fn(),
    handleDragEnd: vi.fn(),
  };
  runtime.features = {
    jobuData: { save: vi.fn() },
    jobuRecords: [],
    jobuLoaded: true,
    jobuWritable: true,
    joboRecords: [],
    joboLoaded: true,
    joboWritable: true,
    joboError: null,
    reloadJobo: vi.fn(),
    recordJobo: vi.fn(),
    getFrameInstancesForDate: () => [],
    focusLog: [],
  };
  runtime.writer = { write: vi.fn(), pendingIds, conflict: null };
  runtime.model = { plans, timedRecords, untimedRecords, invalidRecordCount: 0 };

  const render = () => {
    runtime.cursor = 0;
    const tree = JoboView({});
    const scrollElement = classElement(tree, 'jobo-s5-scroll');
    if (scrollElement?.ref) scrollElement.ref.current = scroll;
    return tree;
  };

  const renderWithLane = () => {
    const tree = render();
    return { tree, laneElement: laneElement(tree, 'plan') };
  };

  return { render, renderWithLane, lane, scroll, createTimelineTask, plans, tasks, cards, planner: runtime.planner };
}

function planElements(tree) {
  return findElements(tree, element => element.props?.item?.id?.startsWith?.('plan-'));
}

function selectPlanCards(harness, windowHarness) {
  let { laneElement: lane } = harness.renderWithLane();
  lane.props.onPointerDown(pointerEvent(harness.lane, { clientX: 0, clientY: 0 }));
  windowHarness.emit('pointermove', pointerEvent(harness.lane, { clientX: 260, clientY: 300 }));
  windowHarness.emit('pointerup', pointerEvent(harness.lane, { clientX: 260, clientY: 300 }));
  const tree = harness.render();
  return { tree, lane: laneElement(tree, 'plan') };
}

describe('JoboView blank-lane interactions', () => {
  let windowHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    runtime.reset();
    windowHarness = createWindowHarness();
    vi.stubGlobal('window', windowHarness.fakeWindow);
    vi.stubGlobal('performance', { now: () => runtime.now });
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-1') });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not create or open a dialog for an ordinary blank-lane click', () => {
    const harness = createHarness();
    const { tree, laneElement: lane } = harness.renderWithLane();
    lane.props.onPointerDown(pointerEvent(harness.lane, { clientX: 50, clientY: 500 }));
    windowHarness.emit('pointerup', pointerEvent(harness.lane, { clientX: 50, clientY: 500 }));

    expect(harness.createTimelineTask).not.toHaveBeenCalled();
    expect(findElement(tree, element => element.props?.role === 'dialog')).toBeUndefined();
    expect(findElement(harness.render(), element => element.props?.role === 'dialog')).toBeUndefined();
  });

  it('double-clicking near midnight creates an untitled 30-minute native Plan', () => {
    const harness = createHarness();
    const { laneElement: lane } = harness.renderWithLane();
    lane.props.onDoubleClick(pointerEvent(harness.lane, { clientX: 80, clientY: 1344 }));

    expect(harness.createTimelineTask).toHaveBeenCalledTimes(1);
    expect(harness.createTimelineTask.mock.calls[0][0]).toMatchObject({
      title: '',
      date: DATE,
      startTime: '23:30',
      duration: 30,
      isAllDay: false,
      completed: false,
    });
  });

  it('starts a marquee on immediate pointer drag and keeps it after the 500ms hold', () => {
    const harness = createHarness();
    let { tree, laneElement: lane } = harness.renderWithLane();
    lane.props.onPointerDown(pointerEvent(harness.lane, { clientX: 0, clientY: 0 }));
    windowHarness.emit('pointermove', pointerEvent(harness.lane, { clientX: 80, clientY: 80 }));

    tree = harness.render();
    expect(classElement(tree, 'jobo-s5-marquee')).toBeDefined();
    expect(classElement(tree, 'jobo-s5-selection-tools')).toBeDefined();
    expect(harness.createTimelineTask).not.toHaveBeenCalled();
    expect(harness.lane.querySelectorAll).toHaveBeenCalled();

    runtime.now = 500;
    vi.advanceTimersByTime(500);
    tree = harness.render();
    expect(classElement(tree, 'jobo-s5-marquee')).toBeDefined();
    expect(harness.createTimelineTask).not.toHaveBeenCalled();
  });

  it('arms after 500ms and creates a range when the pointer is dragged vertically', () => {
    const harness = createHarness();
    const { laneElement: lane } = harness.renderWithLane();
    lane.props.onPointerDown(pointerEvent(harness.lane, { clientX: 40, clientY: 900 }));

    runtime.now = 500;
    vi.advanceTimersByTime(500);
    windowHarness.emit('pointermove', pointerEvent(harness.lane, { clientX: 40, clientY: 600 }));
    windowHarness.emit('pointerup', pointerEvent(harness.lane, { clientX: 40, clientY: 600 }));

    expect(harness.createTimelineTask).toHaveBeenCalledTimes(1);
    const created = harness.createTimelineTask.mock.calls[0][0];
    expect(created.title).toBe('');
    expect(created.duration).toBeGreaterThan(30);
  });

  it.each(['pointercancel', 'escape'])('%s cancels an in-progress creation without writing', action => {
    const harness = createHarness();
    const { laneElement: lane } = harness.renderWithLane();
    lane.props.onPointerDown(pointerEvent(harness.lane, { clientX: 40, clientY: 700 }));

    if (action === 'pointercancel') windowHarness.emit('pointercancel');
    else windowHarness.emit('keydown', { key: 'Escape', preventDefault: vi.fn() });

    expect(harness.createTimelineTask).not.toHaveBeenCalled();
    expect(classElement(harness.render(), 'jobo-s5-create-preview')).toBeUndefined();
  });

  it('does not pass pending writer count into the daily layout stats', () => {
    const harness = createHarness({ pendingIds: ['manual:pending'] });
    const tree = harness.render();
    const stats = findElement(tree, element => element.type === JoboDayStats);

    expect(stats).toBeDefined();
    expect(stats.props.pendingCount ?? 0).toBe(0);
  });

  it('selects two Plan cards and moves them by one shared drag offset', () => {
    const harness = createHarness({ planCount: 2 });
    let { tree } = selectPlanCards(harness, windowHarness);
    const selected = planElements(tree);
    expect(selected).toHaveLength(2);
    expect(selected.every(element => element.props.groupSelected)).toBe(true);

    selected[0].props.onDragStart(dragEvent(harness.cards[0], { clientY: 100 }), selected[0].props.item, 'plan');
    tree = harness.render();
    let lane = laneElement(tree, 'plan');
    lane.props.onDragOver(dragEvent(harness.lane, { clientY: 200 }));
    tree = harness.render();
    expect(findElements(tree, element => element.props?.className === 'jobo-s5-group-preview')).toHaveLength(2);

    lane = laneElement(tree, 'plan');
    lane.props.onDrop(dragEvent(harness.lane, { clientY: 200 }));
    expect(harness.planner.moveTimelineTasks).toHaveBeenCalledTimes(1);
    const [movedTasks, delta] = harness.planner.moveTimelineTasks.mock.calls[0];
    expect(movedTasks.map(task => task.id)).toEqual(['task-1', 'task-2']);
    expect(delta).toBe(45);
  });

  it('drops a selected Plan group into the trash through deleteTimelineTasks', () => {
    const harness = createHarness({ planCount: 2 });
    let { tree } = selectPlanCards(harness, windowHarness);
    const selected = planElements(tree);
    selected[0].props.onDragStart(dragEvent(harness.cards[0], { clientY: 100 }), selected[0].props.item, 'plan');

    tree = harness.render();
    const trash = classElement(tree, 'jobo-s5-trash-target');
    expect(trash).toBeDefined();
    trash.props.onDrop(dragEvent(harness.lane));

    expect(harness.planner.deleteTimelineTasks).toHaveBeenCalledTimes(1);
    expect(harness.planner.deleteTimelineTasks.mock.calls[0][0].map(task => task.id)).toEqual(['task-1', 'task-2']);
  });

  it('keeps a Plan selected when its start time and projection id change', () => {
    const harness = createHarness();
    let tree = harness.render();
    const original = planElements(tree)[0];
    original.props.onSelect({ group: 'group-1', task: 'task-1' }, { shiftKey: false, ctrlKey: false, metaKey: false });

    tree = harness.render();
    expect(planElements(tree)[0].props.groupSelected).toBe(true);
    const shiftedTask = { ...harness.tasks[0], startTime: '10:00' };
    runtime.model.plans = [{
      ...harness.plans[0],
      id: 'plan-1-after-shift',
      startMinute: 600,
      endMinute: 630,
      currentTask: shiftedTask,
      sourceTask: shiftedTask,
      task: shiftedTask,
      plan: { startTime: shiftedTask.startTime, duration: shiftedTask.duration },
    }];
    tree = harness.render();

    expect(planElements(tree)[0].props.item.id).toBe('plan-1-after-shift');
    expect(planElements(tree)[0].props.item.currentTask.startTime).toBe('10:00');
    expect(planElements(tree)[0].props.groupSelected).toBe(true);
    expect(classElement(tree, 'jobo-s5-selection-tools')).toBeDefined();
  });

  it('keeps Plan and linked Do colors in sync after a priority change, including legacy completions', () => {
    const linked = timedItem('linked');
    const legacy = completionItem('legacy');
    const independent = timedItem('independent');
    const harness = createHarness({ timedRecords: [linked, independent], untimedRecords: [legacy] });
    const task = harness.tasks[0];
    task.priority = 3;
    task.color = 'bg-green-500';
    for (const item of [linked, legacy]) {
      item.task = task;
      item.sourceTask = task;
      item.record.taskId = task.id;
    }
    const renderedCards = () => {
      const tree = harness.render();
      const plan = planElements(tree)[0];
      const dos = findElements(tree, element => element.props?.item?.record?.id);
      return [plan, ...dos].map(element => element.type(element.props));
    };
    let cards = renderedCards();
    const priorityFor = id => cards.find(card => (card.props['data-jobo-card'] || card.props['data-jobo-point']) === id).props['data-priority'];
    expect(priorityFor('plan-1')).toBe('p1');
    expect(priorityFor('linked')).toBe('p1');
    expect(priorityFor('legacy')).toBe('p1');
    expect(priorityFor('independent')).toBe('p4');
    expect(cards.every(card => !card.props.className.includes('bg-green-500'))).toBe(true);

    task.priority = 1;
    cards = renderedCards();
    expect(priorityFor('plan-1')).toBe('p3');
    expect(priorityFor('linked')).toBe('p3');
    expect(priorityFor('legacy')).toBe('p3');
    expect(priorityFor('independent')).toBe('p4');
  });

  it('lays overlapping timed Do cards and completion points into separate columns', () => {
    runtime.useRealLayout = true;
    const harness = createHarness({
      timedRecords: [timedItem()],
      untimedRecords: [completionItem('completion-1'), completionItem('completion-2')],
    });
    const tree = harness.render();
    const doCards = findElements(tree, element => element.props?.item?.record?.id);
    const timedCard = doCards.find(element => element.props.item.record.id === 'timed-1');
    const pointCards = doCards.filter(element => element.props.item.point);

    expect(timedCard).toBeDefined();
    expect(pointCards).toHaveLength(2);
    expect(new Set(pointCards.map(element => element.props.item.column)).size).toBe(2);
    expect(new Set([timedCard, ...pointCards].map(element => element.props.item.column)).size).toBe(3);
    expect(new Set(pointCards.map(element => element.props.item.leftPct)).size).toBe(2);
    expect(pointCards.every(element => element.props.item.columnCount === 3)).toBe(true);
  });

  it('keeps historical plans hidden on hover and selection until History is clicked', () => {
    const harness = createHarness({ planCount: 2 });
    runtime.model.plans[1] = { ...runtime.model.plans[1], historical: true, currentTask: null };
    let tree = harness.render();
    expect(planElements(tree)).toHaveLength(1);
    planElements(tree)[0].props.onFocus({ group: 'group-2', task: 'task-2' });
    tree = harness.render();
    expect(planElements(tree)).toHaveLength(1);
    findElement(tree, element => element.type === 'button' && element.props['aria-expanded'] === false).props.onClick();
    expect(planElements(harness.render())).toHaveLength(2);
  });

  it('Check adds problem notes without closing manual notes, including notes in both sets', () => {
    const harness = createHarness({ planCount: 4 });
    harness.tasks[0].completed = true;
    harness.tasks[2].completed = true;
    harness.plans[2].comparison = { comparable: true, durationComparison: 'longer' };
    const check = tree => findElement(tree, element => element.props?.['data-jobo-check'] === true);
    const notes = tree => findElement(tree, element => typeof element.props?.isTaskNoteVisible === 'function');
    const visible = tree => harness.tasks.filter(notes(tree).props.isTaskNoteVisible).map(task => task.id);

    let tree = harness.render();
    expect(check(tree).props['aria-pressed']).toBe(false);
    expect(visible(tree)).toEqual([]);
    planElements(tree)[0].props.onNotes(harness.plans[0]);
    planElements(tree)[3].props.onNotes(harness.plans[3]);
    tree = harness.render();
    expect(visible(tree)).toEqual(['task-1', 'task-4']);

    check(tree).props.onClick();
    tree = harness.render();
    expect(check(tree).props['aria-pressed']).toBe(true);
    expect(visible(tree)).toEqual(['task-1', 'task-2', 'task-3', 'task-4']);
    check(tree).props.onClick();
    tree = harness.render();
    expect(visible(tree)).toEqual(['task-1', 'task-4']);
    expect(runtime.writer.write).not.toHaveBeenCalled();
    expect(runtime.features.recordJobo).not.toHaveBeenCalled();
  });

  it('can dismiss a Check note for this pass and retain it manually on a later pass', () => {
    const harness = createHarness();
    const check = tree => findElement(tree, element => element.props?.['data-jobo-check'] === true);
    const notes = tree => findElement(tree, element => typeof element.props?.isTaskNoteVisible === 'function');
    let tree = harness.render();
    check(tree).props.onClick();
    tree = harness.render();
    expect(notes(tree).props.isTaskNoteVisible(harness.tasks[0])).toBe(true);
    notes(tree).props.onHideTaskNote(harness.tasks[0]);
    tree = harness.render();
    expect(notes(tree).props.isTaskNoteVisible(harness.tasks[0])).toBe(false);
    check(tree).props.onClick();
    check(harness.render()).props.onClick();
    tree = harness.render();
    expect(notes(tree).props.isTaskNoteVisible(harness.tasks[0])).toBe(true);
    notes(tree).props.onShowTaskNote(harness.tasks[0]);
    check(harness.render()).props.onClick();
    expect(notes(harness.render()).props.isTaskNoteVisible(harness.tasks[0])).toBe(true);
  });

  it('updates Check notes when problems are resolved while preserving manually opened ones', () => {
    const harness = createHarness({ planCount: 2 });
    const check = tree => findElement(tree, element => element.props?.['data-jobo-check'] === true);
    const notes = tree => findElement(tree, element => typeof element.props?.isTaskNoteVisible === 'function');
    let tree = harness.render();
    planElements(tree)[0].props.onNotes(harness.plans[0]);
    check(tree).props.onClick();
    tree = harness.render();
    expect(harness.tasks.every(notes(tree).props.isTaskNoteVisible)).toBe(true);
    harness.tasks.forEach(task => { task.completed = true; });
    tree = harness.render();
    expect(notes(tree).props.isTaskNoteVisible(harness.tasks[0])).toBe(true);
    expect(notes(tree).props.isTaskNoteVisible(harness.tasks[1])).toBe(false);
  });

  it('accepts an inbox drag into Plan through the native calendar drop handler', () => {
    const harness = createHarness();
    const inboxTask = { id: 'inbox-task', title: 'Inbox work', duration: 45, priority: 3 };
    harness.planner.draggedTask = inboxTask;
    harness.planner.dragSource = 'inbox';
    harness.planner.handleDropOnCalendar = vi.fn();
    let tree = harness.render();
    const event = dragEvent(harness.lane, { clientY: 420 });
    laneElement(tree, 'plan').props.onDragOver(event);
    expect(event.preventDefault).toHaveBeenCalled();
    tree = harness.render();
    expect(classElement(tree, 'jobo-s5-group-preview')).toBeDefined();
    laneElement(tree, 'plan').props.onDrop(event);
    expect(harness.planner.handleDropOnCalendar).toHaveBeenCalledWith(event, harness.planner.selectedDate, expect.stringMatching(/^\d\d:\d\d$/));
    expect(harness.planner.handleDragEnd).toHaveBeenCalled();
    expect(runtime.writer.write).not.toHaveBeenCalled();
  });

  it('copies an inbox drag into an editable linked Do without removing the inbox task', async () => {
    const harness = createHarness();
    const inboxTask = { id: 'inbox-task', title: 'Inbox work', duration: 45 };
    harness.planner.draggedTask = inboxTask;
    harness.planner.dragSource = 'inbox';
    harness.planner.handleDropOnCalendar = vi.fn();
    runtime.writer.write.mockResolvedValue({ ok: true });
    const tree = harness.render();
    laneElement(tree, 'do').props.onDrop(dragEvent(harness.lane, { clientY: 420 }));
    await Promise.resolve();
    expect(runtime.writer.write).toHaveBeenCalledWith([expect.objectContaining({ taskId: 'inbox-task', title: 'Inbox work', timing: 'timed', source: 'manual', planSnapshot: null })]);
    expect(harness.planner.handleDropOnCalendar).not.toHaveBeenCalled();
  });

  it('does not treat a completion point as a blank Do-lane gesture', () => {
    runtime.useRealLayout = true;
    const harness = createHarness({ untimedRecords: [completionItem('completion-1')] });
    const initialTree = harness.render();
    const pointElement = findElement(initialTree, element => element.props?.item?.point);
    expect(pointElement).toBeDefined();
    const pointCard = pointElement.type(pointElement.props);
    expect(pointCard.props['data-jobo-point']).toBe('completion-1');

    const pointTarget = {
      closest: selector => selector.includes('[data-jobo-point]') ? pointCard : null,
    };
    const lane = laneElement(initialTree, 'do');
    lane.props.onPointerDown(pointerEvent(harness.lane, { target: pointTarget }));
    lane.props.onDoubleClick(pointerEvent(harness.lane, { target: pointTarget }));

    expect(harness.createTimelineTask).not.toHaveBeenCalled();
    expect(runtime.writer.write).not.toHaveBeenCalled();
    expect(runtime.features.recordJobo).not.toHaveBeenCalled();
    expect(classElement(harness.render(), 'jobo-s5-create-preview')).toBeUndefined();
  });
});
