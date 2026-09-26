import { describe, expect, it, vi } from 'vitest';
import { createUndoHistory } from './useUndo.js';

function setup() {
  let state = 0;
  const onSuccess = vi.fn();
  const onFailure = vi.fn();
  const onBusy = vi.fn();
  const history = createUndoHistory({ captureSnapshot: () => state, restoreSnapshot: value => { state = value; }, onSuccess, onFailure, onBusy });
  return { history, onSuccess, onFailure, onBusy, read: () => state, write: value => { state = value; } };
}

describe('shared native and custom undo history', () => {
  it('preserves native/custom/native chronology in both directions', async () => {
    const { history, read, write } = setup();
    let doValue = 'before';
    history.pushUndo(); write(1);
    history.pushUndoAction({ undo: async () => { doValue = 'before'; }, redo: async () => { doValue = 'after'; } });
    doValue = 'after';
    history.pushUndo(); write(2);

    const nativeUndo = history.performUndo();
    expect(read()).toBe(1); // Native setters still happen in this tick.
    expect(await nativeUndo).toBe(true);
    expect(doValue).toBe('after');
    expect(await history.performUndo()).toBe(true);
    expect(doValue).toBe('before');
    expect(read()).toBe(1);
    expect(await history.performUndo()).toBe(true);
    expect(read()).toBe(0);
    expect(await history.performUndo()).toBe(false);

    await history.performRedo(); expect(read()).toBe(1);
    await history.performRedo(); expect(doValue).toBe('after');
    await history.performRedo(); expect(read()).toBe(2);
    expect(await history.performRedo()).toBe(false);
  });

  it('keeps a refused or throwing undo on its stack for a later retry', async () => {
    const { history, onFailure, onSuccess } = setup();
    const undo = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('remote changed')).mockResolvedValue(true);
    const redo = vi.fn().mockResolvedValue(true);
    history.pushUndoAction({ undo, redo });
    expect(await history.performUndo()).toBe(false);
    expect(await history.performRedo()).toBe(false);
    expect(await history.performUndo()).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(await history.performUndo()).toBe(true);
    expect(await history.performRedo()).toBe(true);
    expect(undo).toHaveBeenCalledTimes(3);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('also retains refused redo and prevents overlapping undo/redo', async () => {
    const { history, onBusy } = setup();
    let resolveUndo;
    const undo = vi.fn(() => new Promise(resolve => { resolveUndo = resolve; }));
    const redo = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    history.pushUndoAction({ undo, redo });
    const pending = history.performUndo();
    expect(await history.performUndo()).toBe(false);
    expect(await history.performRedo()).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(onBusy).toHaveBeenCalledTimes(2);
    resolveUndo(true);
    expect(await pending).toBe(true);
    expect(await history.performRedo()).toBe(false);
    expect(await history.performRedo()).toBe(true);
  });

  it('cancels a refused registration and preserves the preceding redo history', async () => {
    const { history, read, write } = setup();
    history.pushUndo(); write(1);
    await history.performUndo();
    const action = { undo: vi.fn(), redo: vi.fn() };
    const cancel = history.pushUndoAction(action);
    expect(cancel()).toBe(true);
    expect(cancel()).toBe(false);
    expect(await history.performRedo()).toBe(true);
    expect(read()).toBe(1);
    expect(action.undo).not.toHaveBeenCalled();
  });

  it('only removes the cancelled reservation when a newer action already exists', async () => {
    const { history, read, write } = setup();
    history.pushUndo(); write(1);
    const action = { undo: vi.fn(), redo: vi.fn() };
    const cancel = history.pushUndoAction(action);
    history.pushUndo(); write(2);
    expect(cancel()).toBe(true);
    await history.performUndo(); expect(read()).toBe(1);
    await history.performUndo(); expect(read()).toBe(0);
    expect(action.undo).not.toHaveBeenCalled();
  });

  it('keeps a new mutation made during async undo and invalidates its obsolete redo', async () => {
    const { history, read, write } = setup();
    let resolveUndo;
    const cancel = history.pushUndoAction({ undo: () => new Promise(resolve => { resolveUndo = resolve; }), redo: vi.fn() });
    const pending = history.performUndo();
    expect(cancel()).toBe(false);
    history.pushUndo(); write(1);
    resolveUndo(true);
    expect(await pending).toBe(true);
    expect(await history.performRedo()).toBe(false);
    await history.performUndo(); expect(read()).toBe(0);
  });

  it('validates custom actions and retains the existing fifty-action limit', async () => {
    const { history, read, write } = setup();
    expect(() => history.pushUndoAction({ undo: () => true })).toThrow(TypeError);
    for (let index = 0; index < 55; index += 1) { history.pushUndo(); write(index + 1); }
    for (let index = 0; index < 50; index += 1) expect(await history.performUndo()).toBe(true);
    expect(read()).toBe(5);
    expect(await history.performUndo()).toBe(false);
  });
});
