import { Effect } from 'effect';
import { MachineUnits, writeUnitOf } from '../../platform/contract/service/units.js';
import type { Intent, IntentLifecycle, IntentReceipt } from '../store/intentLifecycle.js';
import type { MergeRequestRow, MergeRequests } from '../store/mergeRequests.js';
import type { PendingMergeStore, PendingRecord } from '../store/pendingMerges.js';

export const memoryMergeJournal = () => {
  const intents = new Map<string, Intent>();
  const receipts = new Map<string, IntentReceipt>();
  const requests = new Map<string, MergeRequestRow>();
  const pending = new Map<string, PendingRecord>();
  const unit = writeUnitOf<'machine'>({
    store: { path: 'memory', generation: 1 },
    run: () => Effect.die('the memory journal issues no SQL'),
    afterCommit: (work) => work,
  });
  const units = MachineUnits.of({
    read: (work) => work(unit),
    write: (_operation, work) => work(unit),
    markReadOnly: (work) => work,
    markWrite: (work) => work,
  });
  const update = (key: string, change: Partial<Intent>, from?: Intent['phase']) =>
    Effect.sync(() => {
      const standing = intents.get(key);
      if (standing !== undefined && (from === undefined || standing.phase === from)) intents.set(key, { ...standing, ...change });
    });
  const requested = (key: string, change: Partial<MergeRequestRow>) =>
    Effect.sync(() => {
      const standing = requests.get(key);
      if (standing !== undefined) requests.set(key, { ...standing, ...change });
    });
  const lifecycle: IntentLifecycle = {
    read: (key) =>
      Effect.sync(() => {
        const intent = intents.get(key);
        return intent === undefined ? null : { intent, receipt: receipts.get(key) ?? null };
      }),
    intend: (intent) =>
      Effect.sync(() => {
        intents.set(intent.key, intent);
      }),
    claim: (intent, abandoned) =>
      Effect.sync(() => {
        const standing = intents.get(intent.key);
        if (
          standing !== undefined &&
          (abandoned === null || standing.at.getTime() !== abandoned.getTime() || standing.phase !== 'intended')
        )
          return false;
        intents.set(intent.key, intent);
        return true;
      }),
    witness: (key, commit, at) => update(key, { phase: 'publishing', commit, witnessedAt: at }, 'intended'),
    receive: (key, commit, at) =>
      Effect.andThen(
        Effect.sync(() => {
          if (!receipts.has(key)) receipts.set(key, { key, commit, at });
        }),
        update(key, { phase: 'published' }, 'publishing'),
      ),
    settle: (key) => update(key, { phase: 'settled' }, 'published'),
    lose: (key) => update(key, { phase: 'lost' }, 'publishing'),
    forget: (key, at) =>
      Effect.sync(() => {
        const standing = intents.get(key);
        if (
          standing !== undefined &&
          (standing.phase === 'publishing' || standing.phase === 'intended') &&
          (at === undefined || standing.at.getTime() === at.getTime())
        ) {
          intents.delete(key);
          receipts.delete(key);
          requests.delete(key);
        }
      }),
    land: (key, commit, at) =>
      Effect.sync(() => {
        const standing = intents.get(key);
        if (standing?.phase !== 'intended') return false;
        intents.set(key, { ...standing, phase: 'settled', commit, witnessedAt: at });
        receipts.set(key, { key, commit, at });
        return true;
      }),
    open: (kind, after, limit, checkout) =>
      Effect.sync(() =>
        [...intents.values()]
          .filter(
            (intent) =>
              intent.kind === kind &&
              (intent.phase === 'publishing' || intent.phase === 'published' || intent.phase === 'intended') &&
              (checkout === undefined || intent.checkout === checkout) &&
              (after === null || intent.at > after.at || (intent.at.getTime() === after.at.getTime() && intent.key > after.key)),
          )
          .sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key))
          .slice(0, limit),
      ),
    prune: (kind, before, limit) =>
      Effect.sync(() => {
        const gone = [...intents.values()]
          .filter((intent) => intent.kind === kind && (intent.phase === 'settled' || intent.phase === 'lost') && intent.at < before)
          .slice(0, limit);
        for (const intent of gone) {
          intents.delete(intent.key);
          receipts.delete(intent.key);
          requests.delete(intent.key);
        }
        return gone.length;
      }),
  };
  const mergeRequests: MergeRequests = {
    intend: (intent, request) =>
      Effect.sync(() => {
        intents.set(intent.key, intent);
        requests.set(intent.key, request);
      }),
    of: (keys) => Effect.sync(() => new Map([...requests].filter(([key]) => keys.includes(key)))),
    afterRunning: (key) =>
      Effect.suspend(() => (requests.get(key)?.afterState === 'waiting' ? requested(key, { afterState: 'running' }) : Effect.void)),
    afterDone: (key, after) => requested(key, { afterState: 'done', afterDone: after }),
    sourceSettled: (key, sourceState, sourceReason) => requested(key, { sourceState, sourceReason }),
    rulesTold: (key) => requested(key, { rulesAfter: true }),
    tailOpen: (rootId) =>
      Effect.sync(() =>
        [...requests].flatMap(([key, request]) => {
          const intent = intents.get(key);
          return request.rootId === rootId && intent !== undefined && (intent.phase === 'publishing' || intent.phase === 'published')
            ? [intent]
            : [];
        }),
      ),
    close: (_unit, key) =>
      Effect.suspend(() => {
        const standing = intents.get(key);
        return standing?.phase === 'publishing' || standing?.phase === 'published' ? update(key, { phase: 'settled' }) : Effect.void;
      }),
  };
  const pendingStore: PendingMergeStore = {
    byRoot: (root) => Effect.sync(() => pending.get(root) ?? null),
    ofProject: (projectId) => Effect.sync(() => [...pending.values()].filter((record) => record.projectId === projectId)),
    all: () => Effect.sync(() => [...pending.values()]),
    put: (record) =>
      Effect.sync(() => {
        pending.set(record.rootId, record);
      }),
    replace: (read, next) =>
      Effect.sync(() => {
        const standing = pending.get(read.rootId);
        if (standing === undefined || standing.queuedAt.getTime() !== read.queuedAt.getTime() || standing.attempts !== read.attempts)
          return false;
        if (next === null) pending.delete(read.rootId);
        else
          pending.set(read.rootId, {
            ...standing,
            state: next.state,
            attempts: next.attempts,
            refusal: next.refusal,
            stoppedOn: next.stoppedOn,
          });
        return true;
      }),
    dropAsked: (root, asked) =>
      Effect.sync(() => {
        const standing = pending.get(root);
        return standing !== undefined && standing.queuedAt <= asked ? pending.delete(root) : false;
      }),
    drop: (root) => Effect.sync(() => pending.delete(root)),
  };
  return { lifecycle, mergeRequests, pendingStore, units, unit, intents, receipts, requests, pending };
};

export type MemoryMergeJournal = ReturnType<typeof memoryMergeJournal>;
