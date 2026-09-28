import { replaceNativeLifeNodes } from './lifeNodeStore.js';

/** Transient native user commands, not another planning store or sync outbox.
 * Keep React-setter order while a journal commit is in flight. Only receipts
 * from this queue may advance a queued command's expected head; a remote
 * winner still fails the transaction's stale-head check. Stop at the first
 * failure, keeping it and every later command for explicit retry/discard.
 */
export function createNativeLifeQueue(data) {
  const commands = [], ownHeads = new Map(), listeners = new Set();
  let flight = null, state = { pending: 0, error: '' };
  const publish = error => {
    state = { pending: commands.length, error };
    for (const listener of listeners) listener();
  };
  const expectations = command => {
    const expected = new Map(command.expected);
    for (const [entityId, transitions] of ownHeads) {
      let head = expected.get(entityId) ?? null;
      while (transitions.has(head)) head = transitions.get(head);
      if (head !== null) expected.set(entityId, head);
    }
    return expected;
  };
  const remember = receipts => {
    for (const receipt of receipts) {
      if (!ownHeads.has(receipt.entityId)) ownHeads.set(receipt.entityId, new Map());
      ownHeads.get(receipt.entityId).set(receipt.before, receipt.after);
    }
  };
  async function flush() {
    if (flight) return flight;
    if (state.error) return { ok: false, error: state.error };
    flight = (async () => {
      while (commands.length) {
        const command = commands[0];
        try {
          const result = await replaceNativeLifeNodes(data, command.kind, command.updater, expectations(command));
          remember(result.receipts);
          commands.shift();
          publish('');
        } catch (error) {
          publish(error.message || 'storageWrite');
          return { ok: false, error: state.error };
        }
      }
      ownHeads.clear();
      return { ok: true };
    })();
    try { return await flight; }
    finally {
      flight = null;
      // A listener can enqueue another command while the prior promise settles.
      if (commands.length && !state.error) void flush();
    }
  }
  return {
    get: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    enqueue(kind, updater, expected) {
      commands.push({ kind, updater: typeof updater === 'function' ? updater : structuredClone(updater), expected: new Map(expected) });
      publish(state.error);
      return flush();
    },
    retry() { if (!flight) publish(''); return flush(); },
    discard() {
      if (flight) return;
      commands.length = 0; ownHeads.clear(); publish('');
    },
  };
}
